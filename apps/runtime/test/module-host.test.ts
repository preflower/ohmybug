import type {
  WorkspaceProvider,
  WorkspaceProviderFactory,
} from "@oh-my-bug/module-api";
import { describe, expect, it } from "vitest";

import { RuntimeLifecycleHooks } from "../src/modules/lifecycle-hooks.js";
import { ModuleHost } from "../src/modules/module-host.js";
import { WorkspaceRegistry } from "../src/modules/workspace-registry.js";
import { workspaceModule } from "../src/modules/workspace-module.js";
import { project, reviewedIssue } from "./helpers/runtime.js";

function fakeWorkspaceFactory(id: string): WorkspaceProviderFactory {
  return {
    id,
    manifest: { id, name: id, configFields: [] },
    validate() {},
    create(config): WorkspaceProvider {
      return {
        id,
        async acquire({ issue, project: runtimeProject }) {
          return {
            projectPath: runtimeProject.path,
            resourceId: `${id}:${issue.id}:${String(config.marker ?? "")}`,
          };
        },
        async publish() { return undefined; },
        async release() {},
      };
    },
  };
}

describe("internal module host", () => {
  it("mounts multiple reusable Workspace provider instances", async () => {
    const registry = new WorkspaceRegistry();
    const host = new ModuleHost();
    host.mount(workspaceModule, { factory: fakeWorkspaceFactory("local"), registry });
    host.mount(workspaceModule, { factory: fakeWorkspaceFactory("git"), registry });

    await host.start();

    expect(registry.manifests().map((manifest) => manifest.id)).toEqual(["local", "git"]);
    await host.stop();
  });

  it("unregisters a provider when its Cordis ForkScope is disposed", async () => {
    const registry = new WorkspaceRegistry();
    const host = new ModuleHost();
    const mounted = host.mount(workspaceModule, {
      factory: fakeWorkspaceFactory("git"),
      registry,
    });
    await host.start();
    expect(registry.create("git", {}).id).toBe("git");

    mounted.dispose();
    expect(() => registry.create("git", {})).toThrow(
      "WORKSPACE_PROVIDER_NOT_AVAILABLE:git",
    );
    await host.stop();
  });

  it("clones configuration before giving it to a provider factory", async () => {
    const registry = new WorkspaceRegistry();
    registry.register(fakeWorkspaceFactory("local"));
    const config = { marker: "original" };
    const provider = registry.create("local", config);
    config.marker = "changed";

    await expect(provider.acquire({ issue: reviewedIssue(), project })).resolves.toMatchObject({
      resourceId: expect.stringContaining("original"),
    });
  });

  it("rejects duplicate provider IDs until the owner unregisters", () => {
    const registry = new WorkspaceRegistry();
    const unregister = registry.register(fakeWorkspaceFactory("local"));

    expect(() => registry.register(fakeWorkspaceFactory("local"))).toThrow(
      "WORKSPACE_PROVIDER_ALREADY_REGISTERED:local",
    );
    unregister();
    expect(() => registry.register(fakeWorkspaceFactory("local"))).not.toThrow();
  });

  it("isolates hook failures and identifies the owning module", () => {
    const failures: Array<{ owner: string; hook: string; error: unknown }> = [];
    const calls: string[] = [];
    const hooks = new RuntimeLifecycleHooks((owner, hook, error) =>
      failures.push({ owner, hook, error }));
    hooks.on("broken", "issue.completed", () => {
      calls.push("broken");
      throw new Error("PIPELINE_FAILED");
    });
    const unregister = hooks.on("healthy", "issue.completed", () => {
      calls.push("healthy");
    });

    hooks.emit("issue.completed", {
      issue: reviewedIssue({ status: "COMPLETED" }),
      project,
      branch: undefined,
    });
    unregister();
    hooks.emit("issue.completed", {
      issue: reviewedIssue({ status: "COMPLETED" }),
      project,
    });

    expect(calls).toEqual(["broken", "healthy", "broken"]);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({
      owner: "broken",
      hook: "issue.completed",
      error: expect.objectContaining({ message: "PIPELINE_FAILED" }),
    });
  });
});
