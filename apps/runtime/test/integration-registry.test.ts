import type { IntegrationPlugin } from "@oh-my-bug/core";
import { describe, expect, it } from "vitest";

import { IntegrationRegistry } from "../src/integrations/registry.js";

function plugin(id: string, name = id): IntegrationPlugin {
  return {
    manifest: { id, name, configFields: [], secretFields: [] },
    validate: () => undefined,
    create: async () => ({ start: async () => undefined, health: () => ({ state: "stopped" }) }),
    publicError: () => "INTEGRATION_START_FAILED",
  };
}

describe("IntegrationRegistry", () => {
  it("returns cloned sorted manifests and exact plugins", () => {
    const registry = new IntegrationRegistry([plugin("zeta", "Zeta"), plugin("alpha", "Alpha")]);
    const manifests = registry.manifests();

    expect(manifests.map(({ id }) => id)).toEqual(["alpha", "zeta"]);
    expect(registry.require("alpha").manifest.name).toBe("Alpha");
    manifests[0]!.name = "Mutated";
    expect(registry.require("alpha").manifest.name).toBe("Alpha");
  });

  it("rejects duplicate and missing plugins", () => {
    expect(() => new IntegrationRegistry([plugin("same"), plugin("same")]))
      .toThrow("DUPLICATE_INTEGRATION_PLUGIN:same");
    expect(() => new IntegrationRegistry([]).require("missing"))
      .toThrow("PLUGIN_NOT_INSTALLED:missing");
  });

  it("rejects a mismatch between connection-test presentation and implementation", () => {
    const presentationOnly = plugin("presentation-only");
    presentationOnly.manifest.sections = [
      { id: "validation", label: "Validation", connectionTest: true },
    ];
    expect(() => new IntegrationRegistry([presentationOnly]))
      .toThrow("INTEGRATION_CONNECTION_TEST_IMPLEMENTATION_REQUIRED:presentation-only");

    const implementationOnly = {
      ...plugin("implementation-only"),
      testConnection: async () => ({
        title: "Connected",
        details: [],
        testedAt: "2026-08-26T02:00:00.000Z",
      }),
    };
    expect(() => new IntegrationRegistry([implementationOnly]))
      .toThrow("INTEGRATION_CONNECTION_TEST_SECTION_REQUIRED:implementation-only");
  });
});
