import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Issue, RuntimeProject } from "@oh-my-bug/core";
import type { ModuleStateStore } from "@oh-my-bug/module-api";

const execFileAsync = promisify(execFile);

export class MemoryModuleState implements ModuleStateStore {
  private readonly values = new Map<string, unknown>();

  get<T>(moduleId: string, resourceId: string): T | undefined {
    return this.values.get(`${moduleId}:${resourceId}`) as T | undefined;
  }

  set<T>(moduleId: string, resourceId: string, value: T): void {
    this.values.set(`${moduleId}:${resourceId}`, structuredClone(value));
  }

  delete(moduleId: string, resourceId: string): void {
    this.values.delete(`${moduleId}:${resourceId}`);
  }
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}

export async function createGitFixture(projectRelativePath = ".") {
  const root = await mkdtemp(join(tmpdir(), "omb-git-workspace-"));
  const repository = join(root, "repository");
  const worktreeRoot = join(root, "worktrees");
  await mkdir(repository);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.name", "Oh My Bug Test");
  await git(repository, "config", "user.email", "test@ohmybug.local");
  await writeFile(join(repository, "README.md"), "baseline\n");
  if (projectRelativePath !== ".") {
    await mkdir(join(repository, projectRelativePath), { recursive: true });
    await writeFile(join(repository, projectRelativePath, "project.txt"), "project\n");
  }
  await git(repository, "add", "-A");
  await git(repository, "commit", "-m", "baseline");

  const project: RuntimeProject = {
    id: "project-1",
    key: "OMB",
    path: join(repository, projectRelativePath),
  };
  const issue: Issue = {
    id: "issue-1",
    projectId: project.id,
    identifier: "OMB-1",
    title: "Checkout fails",
    titleSource: "user",
    status: "RECEIVED",
    inputs: [],
    revision: 1,
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
  };

  return {
    root,
    repository,
    worktreeRoot,
    project,
    issue,
    state: new MemoryModuleState(),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
