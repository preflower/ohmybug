import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentTurnInterruptedError,
  type RuntimeProject,
} from "@oh-my-bug/core";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntime } from "../../src/composition.js";
import { EvidenceCaptureError } from "../../src/evidence/capture-provider.js";
import { PlaywrightEvidenceCaptureProvider } from "../../src/evidence/playwright-capture-provider.js";
import { FakeAgent, FakeEvidenceCaptureProvider } from "../helpers/fakes.js";
import { project } from "../helpers/runtime.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/evidence",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("independent evidence capture acceptance", () => {
  it.each(["browser", "electron", "command"] as const)(
    "captures %s evidence without rerunning Repair",
    async (mode) => {
      const root = temporaryDirectory(`omb-evidence-${mode}-`);
      const projectRoot = join(root, "project");
      mkdirSync(projectRoot);
      copyFixtures(projectRoot);
      const configured = await captureProject(mode, projectRoot);
      const agent = new FakeAgent();
      agent.nextRepairResult = { summary: "Implemented", evidence: [] };
      const runtime = createRuntime({
        databasePath: join(root, "runtime.sqlite"),
        agent,
        evidenceCapture: new PlaywrightEvidenceCaptureProvider(),
      });
      runtime.registerProject(configured);
      await runtime.start();
      try {
        const issue = await createApprovedIssue(runtime, configured);
        await runtime.drain();

        expect(runtime.getIssue(issue.id)).toMatchObject({
          status: "REVIEW_REQUIRED",
          repair: {
            iteration: 1,
            deliveryDraft: { summary: "Implemented" },
          },
        });
        expect(agent.repairSessions).toEqual(["session-1"]);
        expect(agent.evidenceSessions).toEqual([]);
      } finally {
        await runtime.stop();
      }
    },
    20_000,
  );

  it("restarts during evidence capture with the same draft and retry count", async () => {
    const root = temporaryDirectory("omb-evidence-restart-");
    const projectRoot = join(root, "project");
    mkdirSync(projectRoot);
    const configured = await captureProject("browser", projectRoot);
    const agent = new FakeAgent();
    agent.nextRepairResult = { summary: "Implemented", evidence: [] };
    const provider = new RestartCaptureProvider();
    let sequence = 0;
    const options = {
      databasePath: join(root, "runtime.sqlite"),
      agent,
      evidenceCapture: provider,
      id: () => `restart-evidence-${++sequence}`,
    };
    const runtime = createRuntime(options);
    runtime.registerProject(configured);
    await runtime.start();
    const issue = await createApprovedIssue(runtime, configured);
    await provider.secondAttemptStarted;

    const stopping = runtime.stop();
    provider.interruptSecondAttempt();
    await stopping;

    const reopened = createRuntime(options);
    const before = reopened.getIssue(issue.id);
    expect(before).toMatchObject({
      status: "EVIDENCE_CAPTURE",
      repair: { iteration: 1, evidenceRetries: 1 },
    });
    await reopened.start();
    await reopened.drain();

    expect(reopened.getIssue(issue.id)).toMatchObject({
      status: "REVIEW_REQUIRED",
      repair: {
        iteration: 1,
        evidenceRetries: 1,
        deliveryDraft: before.repair?.deliveryDraft,
      },
    });
    expect(agent.repairSessions).toEqual(["session-1"]);
    await reopened.stop();
  });

  it("recovers a terminal evidence failure without rerunning Repair", async () => {
    const root = temporaryDirectory("omb-evidence-retry-");
    const projectRoot = join(root, "project");
    mkdirSync(projectRoot);
    const configured = await captureProject("browser", projectRoot);
    const agent = new FakeAgent();
    agent.nextRepairResult = { summary: "Implemented", evidence: [] };
    const provider = new FakeEvidenceCaptureProvider();
    provider.error = new EvidenceCaptureError(
      "EVIDENCE_TARGET_UNREACHABLE",
      "browser",
      "127.0.0.1:9",
    );
    const runtime = createRuntime({
      databasePath: join(root, "runtime.sqlite"),
      agent,
      evidenceCapture: provider,
    });
    runtime.registerProject(configured);
    await runtime.start();
    const issue = await createApprovedIssue(runtime, configured);
    await runtime.drain();

    expect(runtime.getIssue(issue.id)).toMatchObject({
      status: "EVIDENCE_FAILED",
      projectPath: expect.any(String),
      repair: { iteration: 1, deliveryDraft: { summary: "Implemented" } },
    });
    expect(agent.repairSessions).toEqual(["session-1"]);

    provider.error = undefined;
    runtime.retryIssue(issue.id);
    await runtime.drain();
    expect(runtime.getIssue(issue.id)?.status).toBe("REVIEW_REQUIRED");
    expect(agent.repairSessions).toEqual(["session-1"]);
    await runtime.stop();
  });
});

class RestartCaptureProvider extends FakeEvidenceCaptureProvider {
  private attempts = 0;
  private markSecondStarted!: () => void;
  private rejectSecond?: (error: Error) => void;
  readonly secondAttemptStarted = new Promise<void>((resolveStarted) => {
    this.markSecondStarted = resolveStarted;
  });

  override async capture(input: Parameters<FakeEvidenceCaptureProvider["capture"]>[0]) {
    this.attempts += 1;
    if (this.attempts === 1) {
      throw new EvidenceCaptureError(
        "EVIDENCE_TARGET_UNREACHABLE",
        "browser",
        "127.0.0.1:9",
      );
    }
    if (this.attempts === 2) {
      this.markSecondStarted();
      return new Promise<Awaited<ReturnType<FakeEvidenceCaptureProvider["capture"]>>>(
        (_resolve, reject) => { this.rejectSecond = reject; },
      );
    }
    return super.capture(input);
  }

  interruptSecondAttempt(): void {
    this.rejectSecond?.(new AgentTurnInterruptedError("RUNTIME_STOPPING"));
  }
}

async function createApprovedIssue(
  runtime: ReturnType<typeof createRuntime>,
  configured: RuntimeProject,
) {
  const created = await runtime.submitManual(configured.id, {
    commandId: `evidence-${configured.id}`,
    content: "Capture acceptance evidence",
  });
  if (created.kind !== "CREATED") throw new Error("CREATED_REQUIRED");
  await runtime.drain();
  const assessed = runtime.getIssue(created.issue.id);
  runtime.approveAssessment(assessed.id, {
    assessmentRevision: assessed.assessment!.revision,
    assessmentContentHash: assessed.assessment!.contentHash,
    title: assessed.assessment!.suggestedTitle,
  });
  return runtime.getIssue(assessed.id);
}

async function captureProject(
  mode: "browser" | "electron" | "command",
  path: string,
): Promise<RuntimeProject> {
  const browserPort = await reservePort();
  const configuredProjects = {
    browser: {
      ...project,
      id: "capture-browser",
      key: "BROWSER",
      path,
      commands: {
        start: `PORT=${browserPort} node browser-server.cjs`,
        acceptanceUrl: `http://127.0.0.1:${browserPort}`,
        evidenceCapture: {
          mode: "browser" as const,
          label: "Browser proof",
          timeoutMs: 15_000,
        },
      },
    },
    electron: {
      ...project,
      id: "capture-electron",
      key: "ELECTRON",
      path,
      commands: {
        evidenceCapture: {
          mode: "electron" as const,
          label: "Electron proof",
          electronEntry: "electron-main.cjs",
          timeoutMs: 15_000,
        },
      },
    },
    command: {
      ...project,
      id: "capture-command",
      key: "COMMAND",
      path,
      commands: {
        evidenceCapture: {
          mode: "command" as const,
          label: "Command proof",
          command: "node write-png.cjs",
          timeoutMs: 15_000,
        },
      },
    },
  } satisfies Record<"browser" | "electron" | "command", RuntimeProject>;
  return configuredProjects[mode];
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function copyFixtures(projectRoot: string): void {
  for (const name of [
    "browser-server.cjs",
    "electron-main.cjs",
    "electron.html",
    "write-png.cjs",
  ]) cpSync(join(fixtures, name), join(projectRoot, name));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("PORT_REQUIRED");
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return address.port;
}
