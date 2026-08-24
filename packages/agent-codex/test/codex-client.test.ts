import { access, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ThreadEvent } from "@openai/codex-sdk";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeEvents, SdkCodexClient, type CodexThread } from "../src/codex-client.js";
import { createTempDir } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];

async function* completedSdkTurn(): AsyncGenerator<ThreadEvent> {
  yield {
    type: "turn.completed",
    usage: { input_tokens: 0, output_tokens: 0 },
  } as ThreadEvent;
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("Codex SDK client lifecycle", () => {
  it("emits cleanup failure after a completed turn instead of rejecting the stream", async () => {
    const events = normalizeEvents(completedSdkTurn(), undefined, async () => {
      throw Object.assign(new Error("directory not empty"), { code: "ENOTEMPTY" });
    });

    await expect(collect(events)).resolves.toEqual([
      { type: "turn.completed" },
      { type: "cleanup.failed", message: "ENOTEMPTY: directory not empty" },
    ]);
  });

  it("keeps a stream failure primary when cleanup also fails", async () => {
    const primary = new Error("turn stream failed");
    const failedSdkTurn: AsyncIterable<ThreadEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => Promise.reject(primary),
        };
      },
    };
    const events = normalizeEvents(failedSdkTurn, undefined, async () => {
      throw Object.assign(new Error("directory not empty"), { code: "ENOTEMPTY" });
    });

    await expect(collect(events)).rejects.toBe(primary);
  });

  it("disposes a writable thread and its private temp before any turn starts", async () => {
    const temporary = await createTempDir("oh-my-bug-codex-client-");
    cleanups.push(temporary.cleanup);
    const projectDirectory = join(temporary.path, "project");
    await mkdir(projectDirectory);
    const thread = new SdkCodexClient().startThread({
      workingDirectory: projectDirectory,
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
      approvalPolicy: "never",
      skipGitRepoCheck: true
    }) as CodexThread & { dispose(): Promise<void> };
    const [privateTemp] = (await readdir(projectDirectory))
      .filter((entry) => entry.startsWith(".oh-my-bug-tmp-"));

    expect(privateTemp).toBeDefined();
    await thread.dispose();

    await expect(access(join(projectDirectory, privateTemp!))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
