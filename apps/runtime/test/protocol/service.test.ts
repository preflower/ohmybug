import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IntegrationPlugin } from "@oh-my-bug/core";
import { ManualIntegrationAdapter } from "@oh-my-bug/integration-manual";
import { localWorkspaceFactory } from "@oh-my-bug/workspace-local";
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
import { FakeAgent } from "../helpers/fakes.js";
import { eventIds, now } from "../helpers/runtime.js";

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

async function harness(secrets = new MemorySecretStore()) {
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
    approveAssessment: commands.approveAssessment.bind(commands),
    approveBugAssessment: commands.approveBugAssessment.bind(commands),
    confirmNotABug: commands.confirmNotABug.bind(commands),
    confirmDuplicate: commands.confirmDuplicate.bind(commands),
    requestReassessment: commands.requestReassessment.bind(commands),
    rejectDelivery: commands.rejectDelivery.bind(commands),
    approveDelivery: commands.approveDelivery.bind(commands),
    retryIssue: commands.retryIssue.bind(commands),
    rebuildAgentSession: commands.rebuildAgentSession.bind(commands),
    cancelIssue: commands.cancelIssue.bind(commands),
    stop: async () => undefined,
  };
  return {
    root,
    store,
    secrets,
    workspacePersistence,
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
  it("inspects a directory without Git and creates a manifest-configured Project", async () => {
    const { root, service } = await harness();
    const projectDirectory = join(root, "checkout app");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectDirectory));

    await expect(service.inspectProject({ path: projectDirectory })).resolves.toEqual({
      path: await realpath(projectDirectory),
      name: "checkout app",
      key: "CHECKOUT-APP",
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
