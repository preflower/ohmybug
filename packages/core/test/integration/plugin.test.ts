import { describe, expect, it } from "vitest";

import {
  integrationPluginManifestSchema,
  type IntegrationPluginManifest,
} from "../../src/index.js";

describe("IntegrationPlugin manifest", () => {
  it("validates and serializes the finite configuration vocabulary", () => {
    const manifest: IntegrationPluginManifest = {
      id: "fixture",
      name: "Fixture",
      configFields: [
        { key: "workspace", type: "string", label: "Workspace", required: true },
        { key: "channels", type: "string[]", label: "Channels", required: true },
        { key: "limit", type: "number", label: "Limit", required: false, defaultValue: 10 },
        { key: "enabled", type: "boolean", label: "Enabled", required: false, defaultValue: true },
      ],
      secretFields: [{ key: "token", label: "Token", required: true }],
    };

    const parsed = integrationPluginManifestSchema.parse(manifest);

    expect(JSON.parse(JSON.stringify(parsed))).toEqual(manifest);
  });

  it("rejects executable or unknown UI fields", () => {
    expect(() => integrationPluginManifestSchema.parse({
      id: "fixture",
      name: "Fixture",
      configFields: [{
        key: "workspace",
        type: "custom",
        label: "Workspace",
        required: true,
        render: "plugin-owned",
      }],
      secretFields: [],
    })).toThrow();
  });

  it("serializes optional Integration presentation sections", () => {
    const manifest: IntegrationPluginManifest = {
      id: "fixture",
      name: "Fixture",
      description: "Receive fixture events.",
      sections: [
        { id: "credentials", label: "Credentials", description: "Stored locally." },
        { id: "advanced", label: "Advanced", collapsed: true },
      ],
      configFields: [{
        key: "filter",
        type: "string",
        label: "Filter",
        required: false,
        section: "advanced",
        placeholder: "error",
      }],
      secretFields: [{
        key: "token",
        label: "Token",
        required: true,
        section: "credentials",
      }],
    };

    expect(integrationPluginManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("rejects duplicate sections and unknown field section references", () => {
    expect(() => integrationPluginManifestSchema.parse({
      id: "fixture",
      name: "Fixture",
      sections: [
        { id: "rules", label: "Rules" },
        { id: "rules", label: "More rules" },
      ],
      configFields: [],
      secretFields: [],
    })).toThrow();
    expect(() => integrationPluginManifestSchema.parse({
      id: "fixture",
      name: "Fixture",
      sections: [{ id: "rules", label: "Rules" }],
      configFields: [{
        key: "filter",
        type: "string",
        label: "Filter",
        required: false,
        section: "missing",
      }],
      secretFields: [],
    })).toThrow();
  });
});
