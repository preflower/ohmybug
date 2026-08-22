import type { IntegrationInput, IntegrationPluginContext } from "@oh-my-bug/core";
import { describe, expect, it, vi } from "vitest";

import type {
  DingTalkClient,
  DingTalkClientFactory,
  DingTalkMessage,
} from "../src/dingtalk-client.js";
import { dingTalkPlugin } from "../src/plugin.js";

class FixtureClient implements DingTalkClient {
  callback?: (message: DingTalkMessage) => void | Promise<void>;
  connect = vi.fn(async () => undefined);
  disconnect = vi.fn(() => undefined);
  acknowledge = vi.fn((messageId: string) => { void messageId; });
  onRobotMessage = vi.fn((callback: (message: DingTalkMessage) => void | Promise<void>) => {
    this.callback = callback;
  });
}

function context(overrides: Partial<IntegrationPluginContext> = {}): IntegrationPluginContext {
  return {
    projectId: "project-1",
    configuration: {
      enabled: true,
      config: {
        conversationIds: ["conversation-1"],
        mention: "@Oh My Bug",
        messageRule: "bug",
        threadKeyField: "conversationId",
      },
      secretRefs: { clientId: "client-id-ref", clientSecret: "client-secret-ref" },
    },
    secrets: { clientId: "client-id", clientSecret: "client-secret" },
    checkpoints: { get: () => undefined, save: () => undefined },
    onInput: async () => undefined,
    id: () => "input-1",
    now: () => new Date("2026-08-21T00:00:00.000Z"),
    ...overrides,
  };
}

describe("DingTalk plugin", () => {
  it("owns its serializable manifest", () => {
    expect(dingTalkPlugin().manifest).toEqual({
      id: "dingtalk",
      name: "DingTalk",
      configFields: [
        { key: "conversationIds", type: "string[]", label: "Conversation IDs", required: true },
        { key: "mention", type: "string", label: "Mention", required: true },
        { key: "messageRule", type: "string", label: "Message rule", required: false },
        { key: "threadKeyField", type: "string", label: "Thread key field", required: false },
      ],
      secretFields: [
        { key: "clientId", label: "Client ID", required: true },
        { key: "clientSecret", label: "Client secret", required: true },
      ],
    });
  });

  it("validates unique conversation IDs and exact fields", () => {
    const plugin = dingTalkPlugin();
    expect(() => plugin.validate(context().configuration)).not.toThrow();
    expect(() => plugin.validate({
      ...context().configuration,
      config: { conversationIds: ["same", "same"], mention: "@Oh My Bug" },
    })).toThrow("DINGTALK_CONFIG_CONVERSATION_IDS_INVALID");
    expect(() => plugin.validate({
      ...context().configuration,
      config: { conversationIds: ["allowed"], mention: "@Oh My Bug", webhook: "no" },
    })).toThrow("DINGTALK_CONFIG_UNKNOWN_FIELD:webhook");
  });

  it("constructs the official client boundary and normalizes allowed messages", async () => {
    const client = new FixtureClient();
    const factory: DingTalkClientFactory = { create: vi.fn(() => client) };
    const accepted: IntegrationInput[] = [];
    const source = await dingTalkPlugin({ clientFactory: factory }).create(context({
      onInput: async (input) => { accepted.push(input); },
    }));
    const controller = new AbortController();
    const started = source.start(controller.signal);
    await vi.waitFor(() => expect(source.health()).toMatchObject({ state: "connected" }));

    await client.callback?.({
      headers: { messageId: "transport-1" },
      data: JSON.stringify({
        conversationId: "conversation-1",
        msgId: "message-1",
        isInAtList: true,
        text: { content: "@Oh My Bug BUG checkout fails" },
      }),
    });
    controller.abort();
    await started;

    expect(factory.create).toHaveBeenCalledWith("client-id", "client-secret");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      integration: "dingtalk",
      inputKey: "message-1",
      groupKey: "conversation-1",
    });
  });

  it("returns only stable public errors and never secret bytes", () => {
    const plugin = dingTalkPlugin();
    expect(plugin.publicError(new Error("DINGTALK_CONFIG_MENTION_REQUIRED")))
      .toBe("DINGTALK_CONFIG_MENTION_REQUIRED");
    expect(plugin.publicError(new Error("client-secret exploded")))
      .toBe("INTEGRATION_START_FAILED");
    expect(plugin.publicError(new Error("client-secret exploded"))).not.toContain("client-secret");
  });
});
