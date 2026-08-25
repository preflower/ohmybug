import { describe, expect, it } from "vitest";

import {
  assessmentSchema,
  canonicalHash,
  deliverySchema,
  repairIntegrationInputSchema,
  repairResultSchema,
} from "../../src/index.js";

describe("Assessment", () => {
  it("accepts a versioned Bug assessment", () => {
    const content = {
      verdict: "BUG",
      suggestedTitle: "支付页无法打开",
      reasoning: "错误稳定复现",
      rootCause: "路由注册缺失",
      solution: "恢复支付页路由",
    };

    expect(
      assessmentSchema.parse({
        revision: 1,
        contentHash: canonicalHash(content),
        ...content,
      }),
    ).toMatchObject({ verdict: "BUG", revision: 1 });
  });

  it("accepts a Feature assessment without a Bug root cause", () => {
    const content = {
      verdict: "FEATURE",
      suggestedTitle: "支持导出验收报告",
      reasoning: "The request adds a new product capability.",
      solution: "Add report generation and an export action.",
    };

    expect(assessmentSchema.parse({
      revision: 2,
      contentHash: canonicalHash(content),
      ...content,
    })).toMatchObject({ verdict: "FEATURE", revision: 2 });
  });

  it("allows duplicate to be suggested but not silently merged", () => {
    const assessment = {
      revision: 2,
      contentHash: "a".repeat(64),
      verdict: "UNCERTAIN",
      suggestedTitle: "疑似重复问题",
      reasoning: "与另一个 Issue 表现相似，需人工确认",
      suspectedDuplicateOf: "issue-12",
    };

    expect(assessmentSchema.parse(assessment).suspectedDuplicateOf).toBe(
      "issue-12",
    );
  });
});

describe("Delivery", () => {
  it.each(["screenshot", "recording"] as const)(
    "accepts %s visual evidence",
    (type) => {
      expect(
        deliverySchema.parse({
          summary: "修复支付页路由",
          evidence: [{ type, label: "支付页正常打开", evidenceId: `sha256-${"a".repeat(64)}` }],
        }),
      ).toMatchObject({ evidence: [{ type }] });
    },
  );

  it("does not bind a Delivery to a source revision", () => {
    const delivery = deliverySchema.parse({
      summary: "修复支付页路由",
      evidence: [{
        type: "screenshot",
        label: "支付页正常打开",
        evidenceId: `sha256-${"a".repeat(64)}`,
      }],
    });

    expect(Object.keys(delivery)).toEqual(["summary", "evidence"]);
  });

  it("rejects structured log evidence and empty evidence", () => {
    expect(() =>
      deliverySchema.parse({
        summary: "修复完成",
        evidence: [{ type: "log", label: "日志", evidenceId: `sha256-${"b".repeat(64)}` }],
      }),
    ).toThrow();
    expect(() =>
      deliverySchema.parse({
        summary: "修复完成",
        evidence: [],
      }),
    ).toThrow();
  });
});

describe("Repair integration", () => {
  const deliveryReady = {
    kind: "DELIVERY_READY",
    summary: "Integrated main and restored the payment route",
    evidence: [{
      type: "screenshot",
      label: "Payment page",
      relativePath: "evidence/payment.png",
    }],
    integration: {
      baseCommit: "a".repeat(40),
      issueCommit: "b".repeat(40),
      conflicts: [{
        path: "src/payment/router.ts",
        classification: "COMPATIBLE_BUSINESS",
        resolution: "Preserved the new guard and restored the route",
      }],
    },
    verification: [{
      command: "pnpm test",
      outcome: "PASSED",
      summary: "All configured tests passed",
    }],
  } as const;

  it("accepts a bounded Git observation and delivery-ready result", () => {
    expect(repairIntegrationInputSchema.parse({
      baseBranch: "main",
      observedBaseCommit: "a".repeat(40),
      issueBranch: "ohmybug/omb-19",
    })).toMatchObject({ baseBranch: "main" });
    expect(repairResultSchema.parse(deliveryReady)).toEqual(deliveryReady);
  });

  it("accepts a bounded mutually-exclusive business decision", () => {
    const result = {
      kind: "BUSINESS_DECISION_REQUIRED",
      summary: "Two rounding rules cannot both define the invoice total",
      decision: {
        baseCommit: "a".repeat(40),
        issueCommit: "b".repeat(40),
        conflictPaths: ["src/billing/total.ts"],
        baseIntent: "Round only the final invoice total",
        issueIntent: "Round every invoice line",
        incompatibility: "The same invoice produces different totals",
        recommendation: "Use per-line rounding",
        rationale: "It matches the Issue acceptance examples",
        choices: [{
          id: "use-issue",
          label: "Use Issue behavior",
          description: "Apply per-line rounding",
        }],
      },
    } as const;

    expect(repairResultSchema.parse(result)).toEqual(result);
  });

  it("requires verification and rejects unbounded paths or text", () => {
    expect(() => repairResultSchema.parse({
      ...deliveryReady,
      verification: [],
    })).toThrow();
    expect(() => repairResultSchema.parse({
      ...deliveryReady,
      summary: "x".repeat(5_000),
    })).toThrow();
    expect(() => repairResultSchema.parse({
      ...deliveryReady,
      evidence: [{ ...deliveryReady.evidence[0], relativePath: "../secret.png" }],
    })).toThrow();
  });
});

describe("hashing", () => {
  it("hashes object keys canonically", () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(
      canonicalHash({ a: 1, b: 2 }),
    );
  });
});
