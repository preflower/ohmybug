import { describe, expect, it } from "vitest";

import { DingTalkIntegrationAdapter } from "../src/dingtalk-adapter.js";

const message = {
  conversationId: "cidCheckoutTeam",
  msgId: "msg-20260819-1",
  isInAtList: true,
  createAt: 1787133480000,
  sessionWebhook: "https://oapi.dingtalk.com/robot/send?access_token=secret-token",
  text: { content: "@OhMyBug 结算页过期会话返回 500，请修复" },
};

describe("DingTalk integration adapter", () => {
  it("keeps a one-sentence message as content without inventing summary or groupKey", async () => {
    const adapter = new DingTalkIntegrationAdapter({
      conversationIds: ["cidCheckoutTeam"],
      secretValues: ["secret-token"],
      id: () => "input-1",
      now: () => new Date("2026-08-20T10:00:00.000Z"),
    });

    const input = await adapter.adapt(message);

    expect(input).toMatchObject({
      integration: "dingtalk",
      inputKey: "msg-20260819-1",
      data: { content: "结算页过期会话返回 500，请修复" },
    });
    expect(input).not.toHaveProperty("groupKey");
    expect(input.data).not.toHaveProperty("summary");
    expect(JSON.stringify(input)).not.toContain("secret-token");
  });

  it("rejects disallowed conversations and messages without the configured mention", async () => {
    const adapter = new DingTalkIntegrationAdapter({
      conversationIds: ["allowed"],
    });

    await expect(adapter.adapt(message)).rejects.toThrow("DINGTALK_CONVERSATION_NOT_ALLOWED");
    await expect(adapter.adapt({
      ...message,
      conversationId: "allowed",
      isInAtList: false,
    })).rejects.toThrow("DINGTALK_MENTION_REQUIRED");
  });

  it("uses an upstream thread key only when that field is explicitly configured", async () => {
    const adapter = new DingTalkIntegrationAdapter({
      conversationIds: ["cidCheckoutTeam"],
      threadKeyField: "threadId",
    });

    await expect(adapter.adapt({ ...message, threadId: "thread-9" }))
      .resolves.toMatchObject({ groupKey: "thread-9" });
  });

  it("uses DingTalk at metadata and removes only a leading robot mention", async () => {
    const adapter = new DingTalkIntegrationAdapter({ conversationIds: ["cidCheckoutTeam"] });

    await expect(adapter.adapt({
      ...message,
      text: { content: "@OhMyBug checkout fails; notify @Alice" },
    })).resolves.toMatchObject({
      data: { content: "checkout fails; notify @Alice" },
    });
  });
});
