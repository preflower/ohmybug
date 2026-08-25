import type {
  FinalizationRecoveryResult,
  Issue,
  RuntimeProject,
  WorkspaceFinalizationDiagnostic,
} from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import type {
  BranchInfo,
  LifecycleEventMap,
  WorkspaceProvider,
  WorkspaceProviderFactory,
} from "../src/index.js";

describe("internal module contracts", () => {
  it("allows providers to prepare and validate bounded finalization recovery", async () => {
    const issue = { id: "issue-1" } as Issue;
    const diagnostic: WorkspaceFinalizationDiagnostic = {
      providerId: "fixture",
      step: "add",
      code: "GIT_COMMAND_FAILED:add",
      message: "Git add failed",
      relatedPaths: [".pnpm-store/tmp/repository"],
    };
    const result: FinalizationRecoveryResult = {
      summary: "Removed generated cache",
      diagnosis: "An empty nested repository blocked Git",
      disposition: "RECOVERED",
      affectedPaths: [".pnpm-store/tmp/repository"],
    };
    const provider: WorkspaceProvider = {
      id: "fixture",
      acquire: async () => ({ projectPath: "/repo", resourceId: "fixture:1" }),
      publish: async () => undefined,
      release: async () => undefined,
      prepareFinalizationRecovery: async () => ({
        fingerprintRef: "fingerprint-1",
        workspaceStatus: "?? .pnpm-store/tmp/repository/",
        fingerprintSummary: "1 diagnostic root",
        recoveryKind: "GENERATED_ARTIFACT_CLEANUP",
      }),
      validateFinalizationRecovery: async () => ({
        kind: "UNCHANGED",
        changedPaths: [],
      }),
    };

    await expect(provider.prepareFinalizationRecovery?.({
      issue,
      resourceId: "fixture:1",
      diagnostic,
      attemptId: "recovery-1",
    })).resolves.toMatchObject({ fingerprintRef: "fingerprint-1" });
    await expect(provider.validateFinalizationRecovery?.({
      issue,
      resourceId: "fixture:1",
      fingerprintRef: "fingerprint-1",
      result,
    })).resolves.toEqual({ kind: "UNCHANGED", changedPaths: [] });
  });

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
