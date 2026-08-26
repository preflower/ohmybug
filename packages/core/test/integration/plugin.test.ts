import { describe, expect, it } from "vitest";

import {
  integrationConnectionTestResultSchema,
  integrationPluginManifestSchema,
  type IntegrationPluginManifest,
} from "../../src/index.js";

describe("IntegrationPlugin manifest", () => {
  it("validates and serializes the finite configuration vocabulary", () => {
    const manifest: IntegrationPluginManifest = {
      id: "fixture",
      name: "Fixture",
      icon: "dingtalk",
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
        { id: "rules", label: "Rules", summary: { label: "Scope", value: "Selected groups" } },
        { id: "advanced", label: "Advanced", collapsed: true },
      ],
      configFields: [{
        key: "filters",
        type: "string[]",
        label: "Filters",
        required: false,
        section: "advanced",
        placeholder: "error",
        addLabel: "Add filter",
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

  it("serializes a connection-test section and config-derived summary", () => {
    const manifest: IntegrationPluginManifest = {
      id: "fixture",
      name: "Fixture",
      sections: [
        { id: "connection", label: "Connection" },
        { id: "validation", label: "Validation", connectionTest: true },
        {
          id: "filters",
          label: "Filters",
          collapsed: true,
          summary: {
            fields: [
              { key: "environment", emptyValue: "All environments" },
              { key: "query", emptyValue: "Unresolved issues", valuePrefix: "Query: " },
            ],
            separator: " · ",
          },
        },
      ],
      configFields: [
        { key: "environment", type: "string", label: "Environment", required: false, section: "filters" },
        { key: "query", type: "string", label: "Query", required: false, section: "filters" },
      ],
      secretFields: [{ key: "token", label: "Token", required: true, section: "connection" }],
    };

    expect(integrationPluginManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("rejects duplicate connection tests and invalid summary field references", () => {
    const base = {
      id: "fixture",
      name: "Fixture",
      configFields: [{ key: "environment", type: "string", label: "Environment", required: false }],
      secretFields: [{ key: "token", label: "Token", required: true }],
    } as const;

    expect(() => integrationPluginManifestSchema.parse({
      ...base,
      sections: [
        { id: "first", label: "First", connectionTest: true },
        { id: "second", label: "Second", connectionTest: true },
      ],
    })).toThrow(/DUPLICATE_INTEGRATION_CONNECTION_TEST/);
    expect(() => integrationPluginManifestSchema.parse({
      ...base,
      sections: [{
        id: "filters",
        label: "Filters",
        summary: { fields: [{ key: "missing", emptyValue: "Any" }] },
      }],
    })).toThrow(/INTEGRATION_SUMMARY_FIELD_NOT_FOUND/);
    expect(() => integrationPluginManifestSchema.parse({
      ...base,
      sections: [{
        id: "filters",
        label: "Filters",
        summary: { fields: [{ key: "token", emptyValue: "Any" }] },
      }],
    })).toThrow(/INTEGRATION_SUMMARY_SECRET_FORBIDDEN/);
  });

  it("validates strict public connection-test results", () => {
    const result = {
      title: "Connected",
      details: [{ label: "Project", value: "checkout" }],
      testedAt: "2026-08-26T02:00:00.000Z",
    };
    expect(integrationConnectionTestResultSchema.parse(result)).toEqual(result);
    expect(() => integrationConnectionTestResultSchema.parse({ ...result, token: "secret" })).toThrow();
    expect(() => integrationConnectionTestResultSchema.parse({ ...result, testedAt: "today" })).toThrow();
  });
});
