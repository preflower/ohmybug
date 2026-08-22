import { describe, expect, it } from "vitest";

import { runtimeProjectSchema } from "../../src/index.js";

describe("RuntimeProject", () => {
  it("accepts channel-neutral product configuration without secret values", () => {
    const project = {
      id: "project-1",
      key: "PAY",
      name: "Payments",
      path: "/repo/payments",
      instructions: "Follow CONTRIBUTING.md",
      commands: {
        test: "pnpm test",
        acceptanceUrl: "http://127.0.0.1:4173",
      },
      agent: {
        plugin: "codex",
      },
      integrations: {
        sentry: {
          enabled: true,
          config: { organization: "acme", project: "payments", environments: ["prod"] },
          secretRefs: { token: "project:project-1:sentry:token" },
        },
      },
      revision: 1,
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
    };

    expect(runtimeProjectSchema.parse(project)).toEqual(project);
  });

  it("rejects plaintext fields and unknown Integration configuration", () => {
    expect(() => runtimeProjectSchema.parse({
      id: "project-1",
      key: "PAY",
      path: "/repo",
      integrations: {
        sentry: {
          enabled: true,
          config: {},
          secretRefs: {},
          token: "plaintext",
        },
      },
    })).toThrow();
  });
});
