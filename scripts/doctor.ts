import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { inspectDesktopRuntime } from "@oh-my-bug/runtime";
import { chromium } from "playwright";

import {
  verifyDesktopBuild,
  verifyRuntimeResources,
} from "../apps/desktop/scripts/packaged-runtime.js";

const exec = promisify(execFile);

export interface Diagnostic {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
}

interface RuntimeSummary { projects: number; integrations: number }

interface DoctorOptions {
  dataRoot?: string;
  execute?: (command: string, args: string[]) => Promise<{ stdout: string }>;
  checkChromium?: () => Promise<string>;
  checkDesktopBuild?: () => Promise<string[]>;
  checkDesktopRuntime?: () => Promise<unknown[]>;
  checkProductRuntime?: (dataRoot: string) => Promise<RuntimeSummary>;
}

export async function collectDiagnostics(options: DoctorOptions = {}): Promise<Diagnostic[]> {
  const execute = options.execute ?? (async (command, args) => exec(command, args));
  const dataRoot = resolve(options.dataRoot ?? process.env.OH_MY_BUG_HOME ?? join(homedir(), ".oh-my-bug"));
  const diagnostics: Diagnostic[] = [{ name: "Node.js", status: "PASS", detail: process.version }];
  diagnostics.push(await commandVersion("pnpm", ["--version"], execute));
  diagnostics.push(await commandVersion("Codex", ["--version"], execute, "codex"));
  diagnostics.push(await authStatus(execute));
  diagnostics.push(await chromiumStatus(options.checkChromium));
  diagnostics.push(await desktopBuildStatus(options.checkDesktopBuild));
  diagnostics.push(await desktopRuntimeStatus(options.checkDesktopRuntime));

  try {
    await mkdir(dataRoot, { recursive: true });
    await access(dataRoot, constants.R_OK | constants.W_OK);
    diagnostics.push({ name: "App data", status: "PASS", detail: dataRoot });
  } catch {
    diagnostics.push({ name: "App data", status: "FAIL", detail: "not readable and writable" });
  }

  diagnostics.push(await commandVersion("Git", ["--version"], execute, "git"));
  try {
    const summary = await (options.checkProductRuntime ?? inspectProductRuntime)(dataRoot);
    diagnostics.push({ name: "Runtime database", status: "PASS", detail: `${summary.projects} configured project(s)` });
    diagnostics.push({ name: "Integrations", status: "PASS", detail: `${summary.integrations} active integration(s)` });
  } catch (error) {
    diagnostics.push({
      name: "Runtime database",
      status: "FAIL",
      detail: error instanceof Error ? error.message : "Runtime could not be started",
    });
  }
  return diagnostics;
}

async function inspectProductRuntime(dataRoot: string): Promise<RuntimeSummary> {
  return inspectDesktopRuntime({ dataRoot });
}

async function desktopBuildStatus(check?: () => Promise<string[]>): Promise<Diagnostic> {
  try {
    const paths = await (check ?? (() => verifyDesktopBuild(resolve(import.meta.dirname, ".."))))();
    return { name: "Desktop build", status: "PASS", detail: `${paths.length} packaged build artifacts ready` };
  } catch {
    return { name: "Desktop build", status: "WARN", detail: "run `pnpm build:desktop` before packaging" };
  }
}

async function desktopRuntimeStatus(check?: () => Promise<unknown[]>): Promise<Diagnostic> {
  try {
    const resources = await (check ?? (async () => Object.values(await verifyRuntimeResources())))();
    return { name: "Desktop runtime", status: "PASS", detail: `${resources.length} bundled resource groups ready` };
  } catch {
    return { name: "Desktop runtime", status: "FAIL", detail: "Codex, MediaInfo, or Chromium package resource is missing" };
  }
}

async function chromiumStatus(check?: () => Promise<string>): Promise<Diagnostic> {
  const executable = chromium.executablePath();
  try {
    await access(executable, constants.X_OK);
    const version = await (check ?? launchChromium)();
    return { name: "Chromium", status: "PASS", detail: `${version} (${executable})` };
  } catch {
    return { name: "Chromium", status: "FAIL", detail: "run `pnpm exec playwright install chromium`" };
  }
}

async function launchChromium(): Promise<string> {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  try {
    return browser.version();
  } finally {
    await browser.close();
  }
}

async function commandVersion(
  name: string,
  args: string[],
  execute: (command: string, args: string[]) => Promise<{ stdout: string }>,
  command = name.toLowerCase(),
): Promise<Diagnostic> {
  try {
    const { stdout } = await execute(command, args);
    const version = /\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? "available";
    return { name, status: "PASS", detail: version };
  } catch {
    return { name, status: "FAIL", detail: "not available" };
  }
}

async function authStatus(execute: (command: string, args: string[]) => Promise<{ stdout: string }>): Promise<Diagnostic> {
  try {
    await execute("codex", ["login", "status"]);
    return { name: "Codex auth", status: "PASS", detail: "authenticated" };
  } catch {
    return { name: "Codex auth", status: "WARN", detail: "authentication required" };
  }
}

async function main(): Promise<void> {
  const diagnostics = await collectDiagnostics();
  for (const diagnostic of diagnostics) {
    process.stdout.write(`${diagnostic.status.padEnd(4)} ${diagnostic.name}: ${diagnostic.detail}\n`);
  }
  if (diagnostics.some((entry) => entry.status === "FAIL")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
