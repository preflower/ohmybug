import { describe, expect, it } from "vitest";

import { GitCommandError, runGit } from "../src/git-client.js";
import { createGitFixture, git } from "./helpers.js";

describe("Git command execution", () => {
  it("redacts credentials, tokens, and unrelated absolute paths from stderr", () => {
    const failure = new GitCommandError({
      cwd: "/workspace/issue",
      args: ["commit"],
      cause: {
        code: 1,
        stderr: [
          "token=private-token",
          "Authorization: Bearer private-bearer",
          "https://user:password@example.com/repository.git?access_token=query-secret",
          "/Users/alice/private/secrets.txt",
          "/workspace/issue/generated/file.txt",
        ].join("\n"),
      },
    });

    expect(failure.stderr).not.toContain("private-token");
    expect(failure.stderr).not.toContain("private-bearer");
    expect(failure.stderr).not.toContain("password");
    expect(failure.stderr).not.toContain("query-secret");
    expect(failure.stderr).not.toContain("/Users/alice");
    expect(failure.stderr).not.toContain("/workspace/issue");
    expect(failure.stderr).toContain("token=[REDACTED]");
    expect(failure.stderr).toContain("Bearer [REDACTED]");
    expect(failure.stderr).toContain("<workspace>/generated/file.txt");
  });

  it("preserves bounded structured command failure details", async () => {
    const value = await createGitFixture();
    try {
      const failure = await runGit(value.repository, [
        "rev-parse",
        "refs/heads/missing",
      ]).catch((error: unknown) => error);
      if (!(failure instanceof GitCommandError)) {
        throw new Error("GIT_COMMAND_ERROR_REQUIRED");
      }

      expect(failure).toMatchObject({
        name: "GitCommandError",
        message: "GIT_COMMAND_FAILED:rev-parse",
        command: "rev-parse",
        args: ["rev-parse", "refs/heads/missing"],
        exitCode: 128,
      });
      expect(failure.stderr.length).toBeLessThanOrEqual(8_000);
      expect(failure.stderr).not.toContain(value.repository);
      expect([...failure.stderr].every((character) => {
        const code = character.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
      })).toBe(true);
    } finally {
      await value.cleanup();
    }
  });

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
