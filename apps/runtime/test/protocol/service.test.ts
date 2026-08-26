import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IntegrationPlugin } from "@oh-my-bug/core";
import { ManualIntegrationAdapter } from "@oh-my-bug/integration-manual";
import { localWorkspaceFactory } from "@oh-my-bug/workspace-local";
import type { WorkspaceProviderFactory } from "@oh-my-bug/module-api";
import {
  LocalEvidenceStore,
  MemorySecretStore,
  openRuntimeDatabase,
  SqliteAgentSessionStore,
  SqliteRuntimeStore,
  SqliteWorkspaceStore,
} from "@oh-my-bug/storage";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRegistry } from "../../src/agents/registry.js";
import { IntegrationRegistry } from "../../src/integrations/registry.js";
import { WorkspaceRegistry } from "../../src/modules/workspace-registry.js";
import { RuntimeCommands } from "../../src/orchestration/commands.js";
import { RuntimeService } from "../../src/service.js";
import type { ApprovalResult } from "../../src/protocol/types.js";
import { FakeAgent } from "../helpers/fakes.js";
import { eventIds, now, project, reviewedIssue } from "../helpers/runtime.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function fixturePlugin(): IntegrationPlugin {
  return {
    manifest: {
      id: "fixture",
      name: "Fixture",
      configFields: [{ key: "workspace", type: "string", label: "Workspace", required: true }],
      secretFields: [
        { key: "token", label: "Token", required: true },
        { key: "secret", label: "Secret", required: true },
      ],
    },
    validate(configuration) {
      if (configuration.enabled && !configuration.config.workspace) {
        throw new Error("FIXTURE_WORKSPACE_REQUIRED");
      }
    },
    create: async () => ({ start: async () => undefined, health: () => ({ state: "connected" }) }),
    publicError: () => "FIXTURE_ERROR",
  };
}

async function harness(
  secrets = new MemorySecretStore(),
  approveDelivery?: (id: string) => Promise<ApprovalResult>,
) {
  const root = await mkdtemp(join(tmpdir(), "omb-runtime-service-"));
  cleanup.push(root);
  const database = openRuntimeDatabase(join(root, "runtime.sqlite"));
  const store = new SqliteRuntimeStore(database, { id: eventIds("issue"), now: () => now });
  const sessions = new SqliteAgentSessionStore(database);
  const workspacePersistence = new SqliteWorkspaceStore(database);
  const workspaceRegistry = new WorkspaceRegistry();
  workspaceRegistry.register(localWorkspaceFactory);
  const agent = new FakeAgent();
  const agents = new AgentRegistry([{ id: "fake", create: () => agent }], {
    sessions,
  });
  const manual = new ManualIntegrationAdapter({ id: eventIds("input"), now: () => new Date(now) });
  const commands = new RuntimeCommands({
    store,
    manual,
    agents,
    id: eventIds("event"),
    now: () => now,
    wake: () => undefined,
  });
  const registry = new IntegrationRegistry([fixturePlugin()]);
  const integrations = {
    refreshProject: async () => undefined,
    health: () => ({}),
  };
  const runtime = {
    health: () => ({ state: "ready" as const }),
    registerProject: commands.registerProject.bind(commands),
    submitManual: commands.submitManual.bind(commands),
    getIssue: commands.getIssue.bind(commands),
    listIssues: commands.listIssues.bind(commands),
    readIssueEvents: commands.readIssueEvents.bind(commands),
    submitReview: commands.submitReview.bind(commands),
    approveAssessment: commands.approveAssessment.bind(commands),
    approveBugAssessment: commands.approveBugAssessment.bind(commands),
    confirmNotABug: commands.confirmNotABug.bind(commands),
    confirmDuplicate: commands.confirmDuplicate.bind(commands),
    requestReassessment: commands.requestReassessment.bind(commands),
    rejectDelivery: commands.rejectDelivery.bind(commands),
    approveDelivery: approveDelivery ?? (async (id: string) => ({
      issue: commands.approveDelivery(id),
    })),
    retryIssue: commands.retryIssue.bind(commands),
    rebuildAgentSession: commands.rebuildAgentSession.bind(commands),
    grantIssueCapabilities: commands.grantIssueCapabilities.bind(commands),
    pauseIssue: commands.pauseIssue.bind(commands),
    resumeIssue: commands.resumeIssue.bind(commands),
    cancelIssue: commands.cancelIssue.bind(commands),
    stop: async () => undefined,
  };
  return {
    root,
    store,
    secrets,
    workspacePersistence,
    workspaceRegistry,
    service: new RuntimeService({
      runtime,
      store,
      secrets,
      evidence: new LocalEvidenceStore(join(root, "evidence")),
      integrations,
      integrationRegistry: registry,
      workspacePersistence,
      workspaceRegistry,
      id: eventIds("project"),
      now: () => now,
    }),
  };
}

describe("RuntimeService", () => {
  it("delegates capability grants with revision and request identity", async () => {
    const { service, store } = await harness();
    store.registerProject(project);
    const paused = reviewedIssue({
      status: "PERMISSION_REQUIRED",
      revision: 7,
      repair: { iteration: 1 },
      pendingCapabilityRequest: {
        id: "request-1",
        operation: "REPAIR",
        stage: "REPAIR",
        resumeStatus: "REPAIRING",
        capabilities: ["HOST_EXECUTION"],
        reason: "Launch Electron acceptance",
        requestedAt: now,
      },
    });
    store.transaction((transaction) => {
      transaction.insertIssue(paused, "REPAIR");
      transaction.updateIssue(paused, paused.revision, null);
    });

    await expect(service.grantIssueCapabilities({
      id: paused.id,
      expectedRevision: paused.revision,
      requestId: "request-1",
    })).resolves.toMatchObject({
      status: "REPAIRING",
      capabilityGrants: [{ capability: "HOST_EXECUTION" }],
    });
  });

  it("discovers branches and validates the selected base ref before persistence", async () => {
    const { root, service, workspaceRegistry } = await harness();
    const projectDirectory = join(root, "branch-project");
    const invalidDirectory = join(root, "invalid");
    await import("node:fs/promises").then(({ mkdir }) => Promise.all([
      mkdir(projectDirectory),
      mkdir(invalidDirectory),
    ]));
    const branchFactory: WorkspaceProviderFactory = {
      id: "branches",
      manifest: { id: "branches", name: "Branches", configFields: [] },
      validate() {},
      validateProjectConfiguration: async (path, config) => {
        if (path.endsWith("invalid") || config.baseBranch === "missing") {
          throw new Error("BASE_BRANCH_NOT_FOUND");
        }
      },
      inspectProjectBranches: async () => ({
        localBranches: ["main"],
        remoteBranches: ["origin/main"],
        publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
      }),
      create: () => ({
        id: "branches",
        acquire: async () => ({ projectPath: "/repo", resourceId: "branches:1" }),
        publish: async () => ({ kind: "PUBLISHED" as const }),
        release: async () => undefined,
      }),
    };
    workspaceRegistry.register(branchFactory);

    await expect(service.inspectProjectBranches({
      path: projectDirectory,
      providerId: "branches",
      refreshRemote: true,
    })).resolves.toEqual({
      localBranches: ["main"],
      remoteBranches: ["origin/main"],
      publicationRemotes: [{ name: "origin", url: "git@example.com:team/repo.git" }],
    });
    await expect(service.createProject({
      path: projectDirectory,
      key: "BAD",
      workspace: {
        provider: "branches",
        config: { baseBranch: "missing" },
      },
    })).rejects.toThrow("BASE_BRANCH_NOT_FOUND");
  });

  it("returns branch information outside the Core Issue", async () => {
    const issue = reviewedIssue({ status: "COMPLETED", resolution: "FIXED" });
    const branch = { name: "ohmybug/omb-2", commit: "abc123" };
    const { service } = await harness(
      new MemorySecretStore(),
      async () => ({ issue, branch }),
    );

    await expect(service.approveDelivery({ id: issue.id })).resolves.toEqual({
      issue,
      branch,
    });
    expect(issue).not.toHaveProperty("branch");
  });

  it("returns null workspace metadata and preserves missing-Issue errors", async () => {
    const { root, service } = await harness();
    const projectDirectory = join(root, "workspace-metadata-project");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));
    const project = await service.createProject({
      path: projectDirectory,
      key: "META",
    });
    const created = await service.submitManual({
      projectId: project.id,
      commandId: "manual-workspace-metadata",
      content: "Show workspace metadata",
    });

    await expect(service.getIssueWorkspace({ id: created.id })).resolves.toBeNull();
    await expect(service.getIssueWorkspace({ id: "missing-issue" }))
      .rejects.toThrow("ISSUE_NOT_FOUND");
  });

  it("inspects a directory without Git and creates a manifest-configured Project", async () => {
    const { root, service } = await harness();
    const projectDirectory = join(root, "checkout app");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));

    await expect(service.inspectProject({ path: projectDirectory })).resolves.toEqual({
      path: await realpath(projectDirectory),
      name: "checkout app",
      key: "CHECKOUT-APP",
      workspaces: { local: { available: true } },
    });
    const created = await service.createProject({
      path: projectDirectory,
      key: "CHECKOUT",
      agent: { plugin: "fake" },
      integrations: { fixture: { enabled: true, config: { workspace: "shop" } } },
    });
    expect(created).toMatchObject({
      key: "CHECKOUT",
      workspace: { provider: "local", config: {} },
      integrations: {
        fixture: {
          config: { workspace: "shop" },
          secretConfigured: { token: false, secret: false },
        },
      },
    });
    await expect(service.listIntegrationPlugins({})).resolves.toEqual([
      expect.objectContaining({ id: "fixture" }),
    ]);
    await expect(service.listWorkspaceProviders({})).resolves.toEqual([
      expect.objectContaining({ id: "local", name: "本机目录" }),
    ]);
  });

  it("isolates Workspace provider inspection evidence and failures", async () => {
    const { root, service, workspaceRegistry } = await harness();
    const projectDirectory = join(root, "checkout");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));
    const provider = (id: string, inspectProject: WorkspaceProviderFactory["inspectProject"]): WorkspaceProviderFactory => ({
      id,
      manifest: { id, name: id, configFields: [] },
      validate() {},
      create: () => ({
        id,
        acquire: async () => ({ projectPath: projectDirectory, resourceId: `${id}:1` }),
        publish: async () => ({ kind: "PUBLISHED" as const }),
        release: async () => undefined,
      }),
      inspectProject,
    });
    workspaceRegistry.register(provider("git", async () => ({
      available: true,
      configPatch: { remote: "origin" },
      fields: { pushToRemote: { enabled: true } },
      properties: [{ key: "remoteUrl", label: "远程仓库", value: "/srv/git/checkout.git" }],
    })));
    workspaceRegistry.register(provider("broken", async () => {
      throw new Error("INSPECTION_FAILED");
    }));

    await expect(service.inspectProject({ path: projectDirectory })).resolves.toMatchObject({
      workspaces: {
        local: { available: true },
        git: {
          available: true,
          configPatch: { remote: "origin" },
          fields: { pushToRemote: { enabled: true } },
          properties: [{ key: "remoteUrl", label: "远程仓库", value: "/srv/git/checkout.git" }],
        },
        broken: { available: false, reason: "INSPECTION_FAILED" },
      },
    });
  });

  it("rejects unavailable Workspace providers without partially updating the Project", async () => {
    const { root, service, store } = await harness();
    const projectDirectory = join(root, "project");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));
    const created = await service.createProject({ path: projectDirectory, key: "SHOP" });

    await expect(service.updateProject({
      id: created.id,
      input: {
        expectedRevision: created.revision,
        name: "Should not persist",
        workspace: { provider: "missing", config: {} },
      },
    })).rejects.toThrow("WORKSPACE_PROVIDER_NOT_AVAILABLE:missing");

    expect(store.getProject(created.id)).toMatchObject({ revision: created.revision });
    expect(store.getProject(created.id)).not.toHaveProperty("name");
    await expect(service.getProject({ id: created.id })).resolves.toMatchObject({
      workspace: { provider: "local", config: {} },
    });
  });

  it("keeps an unavailable persisted Workspace selection visible", async () => {
    const { root, service, workspacePersistence } = await harness();
    const projectDirectory = join(root, "project");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));
    const created = await service.createProject({ path: projectDirectory, key: "SHOP" });
    workspacePersistence.setProjectConfiguration(created.id, {
      provider: "removed-provider",
      config: { retained: true },
    });

    await expect(service.getProject({ id: created.id })).resolves.toMatchObject({
      workspace: {
        provider: "removed-provider",
        config: { retained: true },
        unavailable: "WORKSPACE_PROVIDER_NOT_AVAILABLE:removed-provider",
      },
    });
  });

  it("rejects secret keys that are absent from the plugin manifest", async () => {
    const { root, service } = await harness();
    const projectDirectory = join(root, "project");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));
    const project = await service.createProject({
      path: projectDirectory,
      key: "SHOP",
      integrations: { fixture: { enabled: true, config: { workspace: "shop" } } },
    });

    await expect(service.setIntegrationSecrets({
      id: project.id,
      pluginId: "fixture",
      patch: { unknown: "secret" },
    })).rejects.toThrow("SECRET_FIELD_NOT_DECLARED:unknown");
  });

  it("creates a project and required secrets in one settings save", async () => {
    const { root, service, secrets } = await harness();
    const projectDirectory = join(root, "project-settings-create");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));

    const saved = await service.saveProjectSettings({
      mode: "create",
      project: {
        path: projectDirectory,
        key: "SHOP",
        integrations: {
          fixture: { enabled: true, config: { workspace: "shop" } },
        },
      },
      secretPatches: {
        fixture: { token: "token-value", secret: "secret-value" },
      },
    });

    expect(saved.integrations?.fixture?.secretConfigured).toEqual({
      token: true,
      secret: true,
    });
    await expect(secrets.get(`integration-secret:${saved.id}:fixture:token`))
      .resolves.toBe("token-value");
    await expect(secrets.get(`integration-secret:${saved.id}:fixture:secret`))
      .resolves.toBe("secret-value");
  });

  it("restores secrets when a stale SQLite update rejects", async () => {
    const { root, service, secrets, store } = await harness();
    const projectDirectory = join(root, "project-settings-stale");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));
    const created = await service.saveProjectSettings({
      mode: "create",
      project: {
        path: projectDirectory,
        key: "SHOP",
        integrations: {
          fixture: { enabled: true, config: { workspace: "shop" } },
        },
      },
      secretPatches: {
        fixture: { token: "old-token", secret: "old-secret" },
      },
    });
    const before = store.getProject(created.id);

    await expect(service.saveProjectSettings({
      mode: "update",
      id: created.id,
      expectedRevision: created.revision - 1,
      project: {
        path: projectDirectory,
        key: "SHOP",
        integrations: {
          fixture: { enabled: true, config: { workspace: "changed" } },
        },
      },
      secretPatches: { fixture: { token: "new-token" } },
    })).rejects.toThrow("CONCURRENT_UPDATE");

    await expect(secrets.get(`integration-secret:${created.id}:fixture:token`))
      .resolves.toBe("old-token");
    expect(store.getProject(created.id)).toEqual(before);
  });

  it("reports a stable error when project-settings secret rollback fails", async () => {
    class RollbackFailingSecretStore extends MemorySecretStore {
      failRollback = false;

      override async set(ref: string, value: string): Promise<void> {
        if (this.failRollback && value === "old-token") {
          throw new Error("KEYCHAIN_ROLLBACK_FAILED");
        }
        await super.set(ref, value);
      }
    }

    const secrets = new RollbackFailingSecretStore();
    const { root, service } = await harness(secrets);
    const projectDirectory = join(root, "project-settings-rollback");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));
    const created = await service.saveProjectSettings({
      mode: "create",
      project: {
        path: projectDirectory,
        key: "SHOP",
        integrations: {
          fixture: { enabled: true, config: { workspace: "shop" } },
        },
      },
      secretPatches: { fixture: { token: "old-token", secret: "old-secret" } },
    });
    secrets.failRollback = true;

    await expect(service.saveProjectSettings({
      mode: "update",
      id: created.id,
      expectedRevision: created.revision - 1,
      project: {
        path: projectDirectory,
        key: "SHOP",
        integrations: {
          fixture: { enabled: true, config: { workspace: "changed" } },
        },
      },
      secretPatches: { fixture: { token: "new-token" } },
    })).rejects.toThrow("PROJECT_SETTINGS_ROLLBACK_FAILED");
  });

  it("rolls back project-settings secrets when a later keychain write fails", async () => {
    class FailingSecretStore extends MemorySecretStore {
      override async set(ref: string, value: string): Promise<void> {
        if (ref.endsWith(":secret")) throw new Error("KEYCHAIN_WRITE_FAILED");
        await super.set(ref, value);
      }
    }

    const secrets = new FailingSecretStore();
    const { root, service, store } = await harness(secrets);
    const projectDirectory = join(root, "project-settings-keychain-failure");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));

    await expect(service.saveProjectSettings({
      mode: "create",
      project: {
        path: projectDirectory,
        key: "SHOP",
        integrations: {
          fixture: { enabled: true, config: { workspace: "shop" } },
        },
      },
      secretPatches: {
        fixture: { token: "token-value", secret: "secret-value" },
      },
    })).rejects.toThrow("KEYCHAIN_WRITE_FAILED");

    expect(store.listProjects()).toEqual([]);
    await expect(secrets.get("integration-secret:id-1:fixture:token")).resolves.toBeNull();
    await expect(secrets.get("integration-secret:id-1:fixture:secret")).resolves.toBeNull();
  });

  it("rolls back an atomic plugin secret patch when one keychain write fails", async () => {
    class FailingSecretStore extends MemorySecretStore {
      failNextSecret = false;

      override async set(ref: string, value: string): Promise<void> {
        if (this.failNextSecret && ref.endsWith(":secret")) {
          this.failNextSecret = false;
          throw new Error("KEYCHAIN_WRITE_FAILED");
        }
        await super.set(ref, value);
      }
    }

    const secrets = new FailingSecretStore();
    const { root, service, store } = await harness(secrets);
    const projectDirectory = join(root, "project");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));
    const project = await service.createProject({
      path: projectDirectory,
      key: "SHOP",
      integrations: { fixture: { enabled: true, config: { workspace: "shop" } } },
    });
    await service.setIntegrationSecrets({
      id: project.id,
      pluginId: "fixture",
      patch: { token: "old-token", secret: "old-secret" },
    });
    const before = store.getProject(project.id)!;
    secrets.failNextSecret = true;

    await expect(service.setIntegrationSecrets({
      id: project.id,
      pluginId: "fixture",
      patch: { token: "new-token", secret: "new-secret" },
    })).rejects.toThrow("SECRET_PATCH_FAILED");

    const refs = before.integrations!.fixture!.secretRefs;
    await expect(secrets.get(refs.token!)).resolves.toBe("old-token");
    await expect(secrets.get(refs.secret!)).resolves.toBe("old-secret");
    expect(store.getProject(project.id)).toEqual(before);
  });
});
