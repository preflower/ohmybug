import { access, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SdkCodexClient, type CodexThread } from "../src/codex-client.js";
import { createTempDir } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("Codex SDK client lifecycle", () => {
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
