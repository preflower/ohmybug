import { mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { _electron, chromium, type Browser, type ElectronApplication } from "playwright";

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
    try {
      await waitForReady(url, input.capture.timeoutMs ?? 15_000);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url.href, {
        waitUntil: "networkidle",
        timeout: input.capture.timeoutMs ?? 15_000,
      });
      await page.screenshot({ path: outputPath, fullPage: true });
    } catch (error) {
      if (error instanceof EvidenceCaptureError) throw error;
      throw failure("EVIDENCE_TARGET_UNREACHABLE", input, browserTarget(url), error);
    } finally {
      await browser?.close().catch(() => undefined);
      await owned.stop();
    }
  }

  private async captureElectron(
    input: EvidenceCaptureRequest & { capture: { mode: "electron"; electronEntry: string } },
    outputPath: string,
  ): Promise<void> {
    const entry = resolveElectronEntry(input.workspaceDirectory, input.capture.electronEntry, input);
    let application: ElectronApplication | undefined;
    try {
      application = await _electron.launch({ args: [entry], cwd: input.workspaceDirectory });
      const window = await withTimeout(
        application.firstWindow(),
        input.capture.timeoutMs ?? 15_000,
        () => failure("EVIDENCE_TARGET_UNREACHABLE", input, "electron-window"),
      );
      await window.screenshot({ path: outputPath });
    } catch (error) {
      if (error instanceof EvidenceCaptureError) throw error;
      throw failure(mapSystemFailure(error), input, "electron-entry", error);
    } finally {
      await application?.close().catch(() => undefined);
    }
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
      const result = await withTimeout(
        owned.exited,
        input.capture.timeoutMs ?? 15_000,
        () => failure("EVIDENCE_TARGET_UNREACHABLE", input, "configured-command"),
      );
      if (result.code === 126) {
        throw failure("EVIDENCE_CAPTURE_PERMISSION_DENIED", input, "configured-command");
      }
      if (result.code !== 0) {
        throw failure("EVIDENCE_CAPTURE_PROCESS_FAILED", input, "configured-command");
      }
    } catch (error) {
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
    detached: false,
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
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([exited.catch(() => undefined), delay(2_000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
  };
}

async function waitForReady(url: URL, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new EvidenceCaptureError(
    "EVIDENCE_TARGET_UNREACHABLE",
    "browser",
    browserTarget(url),
  );
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
