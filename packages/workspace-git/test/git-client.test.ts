import { describe, expect, it } from "vitest";

import { runGit } from "../src/git-client.js";
import { createGitFixture, git } from "./helpers.js";

describe("Git command execution", () => {
  it("bounds background network commands and disables interactive prompts", async () => {
    const value = await createGitFixture();
    try {
      await git(value.repository, "config", "alias.check-background-env", "!test \"$GIT_TERMINAL_PROMPT\" = 0 && test \"$GCM_INTERACTIVE\" = Never");
      await expect(runGit(value.repository, ["check-background-env"], {
        nonInteractive: true,
        timeoutMs: 1_000,
      })).resolves.toBe("");

      await git(value.repository, "config", "alias.stall", "!sleep 2");
      const startedAt = Date.now();
      await expect(runGit(value.repository, ["stall"], {
        nonInteractive: true,
        timeoutMs: 20,
      })).rejects.toThrow("GIT_COMMAND_FAILED:stall");
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      await value.cleanup();
    }
  });
});
