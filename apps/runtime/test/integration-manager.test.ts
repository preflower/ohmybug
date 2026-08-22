import type { IntegrationPlugin, ManagedIntegrationSource, RuntimeProject } from "@oh-my-bug/core";
import { describe, expect, it, vi } from "vitest";

import { IntegrationManager } from "../src/integrations/manager.js";
import { IntegrationRegistry } from "../src/integrations/registry.js";

class MemorySecrets {
  readonly values = new Map<string, string>();
  async get(ref: string) { return this.values.get(ref) ?? null; }
}

function project(id: string, pluginId = "healthy"): RuntimeProject {
  return {
    id,
    key: id.toUpperCase(),
    path: `/tmp/${id}`,
    integrations: {
      [pluginId]: {
        enabled: true,
        config: { channel: `${id}-channel` },
        secretRefs: { token: `${id}-token-ref` },
      },
    },
  };
}

function integrationPlugin(
  id: string,
  create: IntegrationPlugin["create"],
  publicError = (error: unknown) => error instanceof Error ? error.message : "FAILED",
): IntegrationPlugin {
  return {
    manifest: {
      id,
      name: id,
      configFields: [{ key: "channel", type: "string", label: "Channel", required: true }],
      secretFields: [{ key: "token", label: "Token", required: true }],
    },
    validate: () => undefined,
    create,
    publicError,
  };
}

function manager(plugins: IntegrationPlugin[], secrets = new MemorySecrets()) {
  return new IntegrationManager({
    registry: new IntegrationRegistry(plugins),
    secrets,
    checkpoints: { get: () => undefined, save: () => undefined },
    onInput: async () => undefined,
    id: () => "input-1",
    now: () => new Date("2026-08-21T00:00:00.000Z"),
  });
}

describe("IntegrationManager", () => {
  it("starts enabled plugins with only their declared secrets and stops idempotently", async () => {
    const starts: string[] = [];
    const stops: string[] = [];
    const secrets = new MemorySecrets();
    secrets.values.set("project-1-token-ref", "token-value");
    secrets.values.set("unused-ref", "must-not-load");
    const create = vi.fn(async (context): Promise<ManagedIntegrationSource> => {
      expect(context.secrets).toEqual({ token: "token-value" });
      return {
        start: async (signal) => {
          starts.push(`${context.projectId}:healthy`);
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          stops.push(`${context.projectId}:healthy`);
        },
        health: () => ({ state: "connected" }),
      };
    });
    const integrations = manager([integrationPlugin("healthy", create)], secrets);

    await integrations.start([project("project-1")]);
    expect(starts).toEqual(["project-1:healthy"]);
    expect(integrations.health()).toEqual({ "project-1:healthy": { state: "connected" } });
    await integrations.stop();
    await integrations.stop();
    expect(stops).toEqual(["project-1:healthy"]);
  });

  it("isolates one plugin creation failure while another project starts", async () => {
    const healthyStart = vi.fn(async () => undefined);
    const integrations = manager([
      integrationPlugin("healthy", async () => ({
        start: healthyStart,
        health: () => ({ state: "connected" }),
      })),
      integrationPlugin(
        "broken",
        async () => { throw new Error("secret bytes leaked"); },
        () => "BROKEN_PLUGIN_CONFIG",
      ),
    ]);

    await integrations.start([project("project-1"), project("project-2", "broken")]);

    expect(healthyStart).toHaveBeenCalledOnce();
    expect(integrations.health()).toEqual({
      "project-1:healthy": { state: "connected" },
      "project-2:broken": { state: "backoff", lastError: "BROKEN_PLUGIN_CONFIG" },
    });
    await integrations.stop();
  });

  it("reports an installed-plugin miss without discarding Project configuration", async () => {
    const integrations = manager([]);
    await integrations.start([project("project-1", "missing")]);

    expect(integrations.health()).toEqual({
      "project-1:missing": { state: "backoff", lastError: "PLUGIN_NOT_INSTALLED:missing" },
    });
  });
});
