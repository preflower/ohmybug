import { describe, expect, it } from "vitest";

import { runtimeProjectSchema } from "../../src/index.js";

describe("RuntimeProject", () => {
  it.each([
    "request-approval",
    "auto-review",
    "full-access",
  ] as const)("accepts the %s project permission mode", (permissionMode) => {
    expect(runtimeProjectSchema.parse({
      id: "project-1",
      key: "PAY",
      path: "/repo/payments",
      permissionMode,
    }).permissionMode).toBe(permissionMode);
  });

  it("rejects an unknown project permission mode", () => {
    expect(() => runtimeProjectSchema.parse({
      id: "project-1",
      key: "PAY",
      path: "/repo/payments",
      permissionMode: "allow-everything",
    })).toThrow();
  });

  it("accepts channel-neutral product configuration without secret values", () => {
    const project = {
      id: "project-1",
      key: "PAY",
      name: "Payments",
      path: "/repo/payments",
      instructions: "Follow CONTRIBUTING.md",
      commands: {
        start: "pnpm dev --host 127.0.0.1",
        test: "pnpm test",
        acceptanceUrl: "http://127.0.0.1:4173/payment",
        evidenceCapture: {
          mode: "browser",
          label: "Payment page",
          timeoutMs: 15_000,
        },
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

  it.each([
    { mode: "electron", label: "Desktop proof", electronEntry: "dist/main.js" },
    { mode: "command", label: "API proof", command: "node scripts/capture.mjs" },
  ] as const)("accepts $mode evidence capture when its target is configured", (evidenceCapture) => {
    expect(runtimeProjectSchema.parse({
      id: "project-1",
      key: "PAY",
      path: "/repo/payments",
      commands: { evidenceCapture },
    }).commands?.evidenceCapture).toEqual(evidenceCapture);
  });

  it.each([
    { mode: "electron", label: "Desktop proof" },
    { mode: "command", label: "API proof" },
  ])("rejects incomplete $mode evidence capture", (evidenceCapture) => {
    expect(() => runtimeProjectSchema.parse({
      id: "project-1",
      key: "PAY",
      path: "/repo/payments",
      commands: { evidenceCapture },
    })).toThrow();
  });

  it.each([
    "https://example.com/payment",
    "http://192.168.1.5:4173/payment",
  ])("rejects a non-local browser target %s", (acceptanceUrl) => {
    expect(() => runtimeProjectSchema.parse({
      id: "project-1",
      key: "PAY",
      path: "/repo/payments",
      commands: {
        start: "pnpm dev",
        acceptanceUrl,
        evidenceCapture: { mode: "browser", label: "Payment page" },
      },
    })).toThrow(/ACCEPTANCE_URL_MUST_BE_LOCALHOST/);
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
