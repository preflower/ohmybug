import type { RuntimeProject } from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import type {
  BranchInfo,
  LifecycleEventMap,
  WorkspaceProviderFactory,
} from "../src/index.js";

describe("internal module contracts", () => {
  it("keeps branch data outside the Core project model", () => {
    const branch: BranchInfo = { name: "ohmybug/omb-1", commit: "abc123" };
    const project: RuntimeProject = { id: "p1", key: "P1", path: "/repo" };
    const factory = { id: "local" } as WorkspaceProviderFactory;
    const event: keyof LifecycleEventMap = "issue.completed";

    expect({ branch, project, factory: factory.id, event }).toBeTruthy();
  });

  it("allows a Workspace provider to describe read-only project capabilities", async () => {
    const factory: WorkspaceProviderFactory = {
      id: "fixture",
      manifest: { id: "fixture", name: "Fixture", configFields: [] },
      validate() {},
      create: () => ({
        id: "fixture",
        acquire: async () => ({ projectPath: "/repo", resourceId: "fixture:1" }),
        publish: async () => undefined,
        release: async () => undefined,
      }),
      inspectProject: async () => ({
        available: true,
        configPatch: { remote: "origin" },
        fields: { pushToRemote: { enabled: true } },
        properties: [{
          key: "remoteUrl",
          label: "远程仓库",
          value: "git@example.com:team/repo.git",
        }],
      }),
    };

    await expect(factory.inspectProject?.("/repo")).resolves.toMatchObject({
      available: true,
      configPatch: { remote: "origin" },
    });
  });

  it("allows providers to discover and validate project branch refs", async () => {
    const factory: WorkspaceProviderFactory = {
      id: "fixture",
      manifest: { id: "fixture", name: "Fixture", configFields: [] },
      validate() {},
      create: () => ({
        id: "fixture",
        acquire: async () => ({ projectPath: "/repo", resourceId: "fixture:1" }),
        publish: async () => undefined,
        release: async () => undefined,
      }),
      inspectProjectBranches: async (_path, input) => ({
        localBranches: ["main"],
        remoteBranches: input.refreshRemote ? ["origin/main"] : [],
        fetchRemote: { name: "origin", url: "git@example.com:team/repo.git" },
        publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
      }),
      validateProjectConfiguration: async () => undefined,
    };

    await expect(factory.inspectProjectBranches?.("/repo", { refreshRemote: true }))
      .resolves.toEqual({
        localBranches: ["main"],
        remoteBranches: ["origin/main"],
        fetchRemote: { name: "origin", url: "git@example.com:team/repo.git" },
        publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
      });
    await expect(factory.validateProjectConfiguration?.("/repo", {}))
      .resolves.toBeUndefined();
  });
});
