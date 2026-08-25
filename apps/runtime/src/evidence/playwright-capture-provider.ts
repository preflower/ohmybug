import { mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import {
  _electron,
  chromium,
  type Browser,
  type BrowserServer,
  type ElectronApplication,
} from "playwright";

import {
  EvidenceCaptureError,
  type EvidenceCaptureArtifact,
  type EvidenceCaptureFailureCode,
  type EvidenceCaptureProvider,
  type EvidenceCaptureRequest,
} from "./capture-provider.js";

interface OwnedProcess {
  child: ChildProcess;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stop(): Promise<void>;
}

export class PlaywrightEvidenceCaptureProvider implements EvidenceCaptureProvider {
  async capture(input: EvidenceCaptureRequest): Promise<EvidenceCaptureArtifact> {
    input.signal?.throwIfAborted();
    await mkdir(input.intakeDirectory, { recursive: true });
    const outputPath = resolveInside(input.intakeDirectory, "evidence.png");

    switch (input.capture.mode) {
      case "browser":
        await this.captureBrowser({ ...input, capture: input.capture }, outputPath);
        break;
      case "electron":
        await this.captureElectron({ ...input, capture: input.capture }, outputPath);
        break;
      case "command":
        await this.captureCommand({ ...input, capture: input.capture }, outputPath);
        break;
    }

    input.signal?.throwIfAborted();
    await verifyOutput(input, outputPath);
    return {
      type: "screenshot",
      label: input.capture.label,
      path: outputPath,
    };
  }

  private async captureBrowser(
    input: EvidenceCaptureRequest & { capture: { mode: "browser" } },
    outputPath: string,
  ): Promise<void> {
    const start = input.commands.start;
    const acceptanceUrl = input.commands.acceptanceUrl;
    if (!start || !acceptanceUrl) {
      throw failure("EVIDENCE_CAPTURE_PROCESS_FAILED", input, "localhost");
    }
    let url: URL;
    try {
      url = new URL(acceptanceUrl);
    } catch (error) {
      throw failure("EVIDENCE_TARGET_UNREACHABLE", input, "localhost", error);
    }
    if (!isLocalhost(url)) {
      throw failure("EVIDENCE_CAPTURE_PERMISSION_DENIED", input, browserTarget(url));
    }

    const owned = startOwned(start, input.workspaceDirectory, process.env);
    let browser: Browser | undefined;
    let server: BrowserServer | undefined;
    let captureError: unknown;
    try {
      await waitForReady(url, input.capture.timeoutMs ?? 15_000, input.signal);
      server = await chromium.launchServer({ headless: true });
      browser = await chromium.connect(server.wsEndpoint());
      input.signal?.throwIfAborted();
      const page = await browser.newPage();
      await abortable(page.goto(url.href, {
        waitUntil: "networkidle",
        timeout: input.capture.timeoutMs ?? 15_000,
      }), input.signal);
      await abortable(page.screenshot({ path: outputPath, fullPage: true }), input.signal);
    } catch (error) {
      captureError = input.signal?.aborted
        ? input.signal.reason
        : error instanceof EvidenceCaptureError
          ? error
          : failure("EVIDENCE_TARGET_UNREACHABLE", input, browserTarget(url), error);
    }
    const cleanupFailures: unknown[] = [];
    const activeServer = server;
    if (activeServer) {
      try {
        await closeManagedProcess(() => activeServer.close(), activeServer.process());
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    try {
      await owned.stop();
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length > 0) throw cleanupFailures[0];
    if (captureError) throw captureError;
  }

  private async captureElectron(
    input: EvidenceCaptureRequest & { capture: { mode: "electron"; electronEntry: string } },
    outputPath: string,
  ): Promise<void> {
    const entry = resolveElectronEntry(input.workspaceDirectory, input.capture.electronEntry, input);
    let application: ElectronApplication | undefined;
    let captureError: unknown;
    try {
      application = await _electron.launch({ args: [entry], cwd: input.workspaceDirectory });
      input.signal?.throwIfAborted();
      const window = await abortable(withTimeout(
        application.firstWindow(),
        input.capture.timeoutMs ?? 15_000,
        () => failure("EVIDENCE_TARGET_UNREACHABLE", input, "electron-window"),
      ), input.signal);
      await abortable(window.screenshot({ path: outputPath }), input.signal);
    } catch (error) {
      captureError = input.signal?.aborted
        ? input.signal.reason
        : error instanceof EvidenceCaptureError
          ? error
          : failure(mapSystemFailure(error), input, "electron-entry", error);
    }
    const activeApplication = application;
    if (activeApplication) {
      await closeManagedProcess(
        () => activeApplication.close(),
        activeApplication.process(),
      );
    }
    if (captureError) throw captureError;
  }

  private async captureCommand(
    input: EvidenceCaptureRequest & { capture: { mode: "command"; command: string } },
    outputPath: string,
  ): Promise<void> {
    const owned = startOwned(input.capture.command, input.workspaceDirectory, {
      ...process.env,
      OH_MY_BUG_EVIDENCE_PATH: outputPath,
      OH_MY_BUG_EVIDENCE_DIRECTORY: input.intakeDirectory,
    });
    try {
      const result = await abortable(withTimeout(
        owned.exited,
        input.capture.timeoutMs ?? 15_000,
        () => failure("EVIDENCE_TARGET_UNREACHABLE", input, "configured-command"),
      ), input.signal);
      if (result.code === 126) {
        throw failure("EVIDENCE_CAPTURE_PERMISSION_DENIED", input, "configured-command");
      }
      if (result.code !== 0) {
        throw failure("EVIDENCE_CAPTURE_PROCESS_FAILED", input, "configured-command");
      }
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason;
      if (error instanceof EvidenceCaptureError) throw error;
      throw failure(mapSystemFailure(error), input, "configured-command", error);
    } finally {
      await owned.stop();
    }
  }
}

function startOwned(command: string, cwd: string, env: NodeJS.ProcessEnv): OwnedProcess {
  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    },
  );
  return {
    child,
    exited,
    async stop() {
      const pid = child.pid;
      if (!pid) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited.catch(() => undefined);
        return;
      }
      if (process.platform === "win32") {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await stopWindowsProcessTree(pid);
        await withTimeout(
          exited.catch(() => ({ code: null, signal: null })),
          2_000,
          () => new Error("EVIDENCE_PROCESS_TREE_STOP_FAILED"),
        );
        return;
      }
      signalProcessGroup(pid, "SIGTERM");
      if (!await waitForProcessGroupExit(pid, 2_000)) {
        signalProcessGroup(pid, "SIGKILL");
        if (!await waitForProcessGroupExit(pid, 2_000)) {
          throw new Error("EVIDENCE_PROCESS_TREE_STOP_FAILED");
        }
      }
      await exited.catch(() => undefined);
    },
  };
}

async function closeManagedProcess(
  close: () => Promise<void>,
  child: ChildProcess,
): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    await withTimeout(close(), 2_000, processStopFailure);
    return;
  }
  const tracked = process.platform === "win32"
    ? [pid]
    : [pid, ...await listDescendantPids(pid)];
  try {
    await withTimeout(close(), 2_000, processStopFailure);
  } catch {
    if (await waitForPidsExit(tracked, 100)) return;
    await forceStopManagedProcessTree(child, tracked);
    return;
  }
  if (!await waitForPidsExit(tracked, 500)) {
    await forceStopManagedProcessTree(child, tracked);
  }
}

async function forceStopManagedProcessTree(
  child: ChildProcess,
  tracked: number[],
): Promise<void> {
  const pid = child.pid;
  if (!pid) throw processStopFailure();
  if (process.platform === "win32") {
    await stopWindowsProcessTree(pid);
    if (!await waitForPidsExit(tracked, 2_000)) throw processStopFailure();
    return;
  }
  const descendants = [...new Set([
    ...tracked.filter((candidate) => candidate !== pid),
    ...await listDescendantPids(pid),
  ])];
  signalProcesses([...descendants.reverse(), pid], "SIGTERM");
  if (await waitForPidsExit([pid, ...descendants], 1_000)) return;
  signalProcesses([...descendants, pid], "SIGKILL");
  if (!await waitForPidsExit([pid, ...descendants], 2_000)) throw processStopFailure();
}

async function listDescendantPids(rootPid: number): Promise<number[]> {
  const output = await new Promise<string>((resolveList, rejectList) => {
    const listing = spawn("ps", ["-A", "-o", "pid=,ppid="], {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    listing.stdout?.setEncoding("utf8");
    listing.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    listing.once("error", rejectList);
    listing.once("exit", (code) => {
      if (code === 0) resolveList(stdout);
      else rejectList(processStopFailure());
    });
  });
  const children = new Map<number, number[]>();
  for (const line of output.split("\n")) {
    const [pidText, parentText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const parent = Number(parentText);
    if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  const descendants: number[] = [];
  const pending = [...(children.get(rootPid) ?? [])];
  while (pending.length > 0) {
    const pid = pending.shift()!;
    descendants.push(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return descendants;
}

function signalProcesses(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (nodeErrorCode(error) !== "ESRCH") throw error;
    }
  }
}

async function waitForPidsExit(pids: number[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isPidAlive(pid))) return true;
    await delay(25);
  }
  return pids.every((pid) => !isPidAlive(pid));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return nodeErrorCode(error) !== "ESRCH";
  }
}

function processStopFailure(): Error {
  return new Error("EVIDENCE_PROCESS_TREE_STOP_FAILED");
}

async function stopWindowsProcessTree(pid: number): Promise<void> {
  await new Promise<void>((resolveStop, rejectStop) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", rejectStop);
    killer.once("exit", (code) => {
      if (code === 0) resolveStop();
      else rejectStop(new Error("EVIDENCE_PROCESS_TREE_STOP_FAILED"));
    });
  });
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (nodeErrorCode(error) !== "ESRCH") throw error;
  }
}

async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessGroupAlive(pid)) return true;
    await delay(25);
  }
  return !isProcessGroupAlive(pid);
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return nodeErrorCode(error) !== "ESRCH";
  }
}

async function waitForReady(
  url: URL,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const response = await abortable(
        fetch(url, { signal: AbortSignal.timeout(1_000) }),
        signal,
      );
      if (response.ok) return;
    } catch {
      signal?.throwIfAborted();
      await abortable(delay(100), signal);
    }
  }
  throw new EvidenceCaptureError(
    "EVIDENCE_TARGET_UNREACHABLE",
    "browser",
    browserTarget(url),
  );
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function resolveElectronEntry(
  workspaceDirectory: string,
  entry: string,
  input: EvidenceCaptureRequest & { capture: { mode: "electron" } },
): string {
  if (isAbsolute(entry) || entry.split(/[\\/]/).includes("..")) {
    throw failure("EVIDENCE_CAPTURE_PERMISSION_DENIED", input, "electron-entry");
  }
  const resolved = resolve(workspaceDirectory, entry);
  if (!isInside(workspaceDirectory, resolved)) {
    throw failure("EVIDENCE_CAPTURE_PERMISSION_DENIED", input, "electron-entry");
  }
  return resolved;
}

function resolveInside(directory: string, name: string): string {
  const output = resolve(directory, name);
  if (!isInside(directory, output)) throw new Error("EVIDENCE_OUTPUT_ESCAPE");
  return output;
}

async function verifyOutput(input: EvidenceCaptureRequest, outputPath: string): Promise<void> {
  try {
    const [actualDirectory, actualOutput, outputStat] = await Promise.all([
      realpath(input.intakeDirectory),
      realpath(outputPath),
      stat(outputPath),
    ]);
    if (!isInside(actualDirectory, actualOutput)) {
      throw failure(
        "EVIDENCE_CAPTURE_PERMISSION_DENIED",
        input,
        publicTarget(input),
      );
    }
    if (!outputStat.isFile() || outputStat.size === 0) {
      throw failure("EVIDENCE_FILE_MISSING", input, publicTarget(input));
    }
  } catch (error) {
    if (error instanceof EvidenceCaptureError) throw error;
    const code = nodeErrorCode(error);
    if (code === "ENOENT") throw failure("EVIDENCE_FILE_MISSING", input, publicTarget(input), error);
    throw failure(mapSystemFailure(error), input, publicTarget(input), error);
  }
}

function isInside(directory: string, candidate: string): boolean {
  const path = relative(resolve(directory), resolve(candidate));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function isLocalhost(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function browserTarget(url: URL): string {
  return `${url.hostname}:${url.port}`;
}

function publicTarget(input: EvidenceCaptureRequest): string {
  if (input.capture.mode === "command") return "configured-command";
  if (input.capture.mode === "electron") return "electron-entry";
  try {
    return browserTarget(new URL(input.commands.acceptanceUrl ?? "http://localhost"));
  } catch {
    return "localhost";
  }
}

function mapSystemFailure(error: unknown): EvidenceCaptureFailureCode {
  const code = nodeErrorCode(error);
  if (code === "EACCES" || code === "EPERM") return "EVIDENCE_CAPTURE_PERMISSION_DENIED";
  return "EVIDENCE_CAPTURE_PROCESS_FAILED";
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function failure(
  code: EvidenceCaptureFailureCode,
  input: EvidenceCaptureRequest,
  target: string,
  cause?: unknown,
): EvidenceCaptureError {
  return new EvidenceCaptureError(
    code,
    input.capture.mode,
    target,
    cause === undefined ? undefined : { cause },
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: () => Error,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(timeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
