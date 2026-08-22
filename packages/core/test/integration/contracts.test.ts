import { describe, expect, it } from "vitest";

import {
  dataSchema,
  integrationInputSchema,
  type IntegrationAdapter,
  type IntegrationInput,
} from "../../src/index.js";

describe("Data", () => {
  it("accepts a one-sentence channel message without inventing a summary", () => {
    expect(dataSchema.parse({ content: "支付页打不开" })).toEqual({
      content: "支付页打不开",
    });
  });

  it("rejects blank content and unknown normalized fields", () => {
    expect(() => dataSchema.parse({ content: "  " })).toThrow();
    expect(() =>
      dataSchema.parse({ content: "支付页打不开", channel: "dingtalk" }),
    ).toThrow();
  });
});

describe("IntegrationInput", () => {
  it("keeps channel payload and normalized data together", () => {
    const input = {
      id: "input-1",
      integration: "dingtalk",
      inputKey: "message-123",
      groupKey: "conversation-9",
      rawData: { text: "支付页打不开" },
      data: { content: "支付页打不开" },
      receivedAt: "2026-08-20T02:00:00.000Z",
    };

    expect(integrationInputSchema.parse(input)).toEqual(input);
  });

  it("allows inputs that have no deterministic group key", () => {
    expect(
      integrationInputSchema.parse({
        id: "input-2",
        integration: "manual",
        inputKey: "manual-2",
        rawData: { text: "列表加载失败" },
        data: { content: "列表加载失败" },
        receivedAt: "2026-08-20T02:01:00.000Z",
      }),
    ).not.toHaveProperty("groupKey");
  });

  it("supports a typed adapter without exposing channel fields to Core", async () => {
    const adapter: IntegrationAdapter<{ text: string }> = {
      name: "manual",
      async adapt(rawData): Promise<IntegrationInput<{ text: string }>> {
        return {
          id: "input-3",
          integration: "manual",
          inputKey: "manual-3",
          rawData,
          data: { content: rawData.text },
          receivedAt: "2026-08-20T02:02:00.000Z",
        };
      },
    };

    await expect(adapter.adapt({ text: "按钮无响应" })).resolves.toMatchObject({
      integration: "manual",
      data: { content: "按钮无响应" },
    });
  });
});
