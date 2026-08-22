import { describe, expect, it } from "vitest";

import { ManualIntegrationAdapter } from "../src/index.js";

function adapter(): ManualIntegrationAdapter {
  return new ManualIntegrationAdapter({
    id: () => "input-1",
    now: () => new Date("2026-08-20T13:00:00.000Z"),
  });
}

describe("Manual Integration adapter", () => {
  it("accepts one-line content without inventing title or description", async () => {
    await expect(adapter().adapt({
      commandId: "command-1",
      content: "支付页打不开",
    })).resolves.toEqual({
      id: "input-1",
      integration: "manual",
      inputKey: "command-1",
      rawData: { commandId: "command-1", content: "支付页打不开" },
      data: { content: "支付页打不开" },
      receivedAt: "2026-08-20T13:00:00.000Z",
    });
  });

  it("normalizes optional summary while preserving raw context", async () => {
    const rawData = {
      commandId: " command-2 ",
      content: "  Checkout returns 500  ",
      summary: "  Checkout failure  ",
      context: { environment: "test", attempts: 2 },
    };
    await expect(adapter().adapt(rawData)).resolves.toMatchObject({
      inputKey: "command-2",
      rawData,
      data: {
        content: "Checkout returns 500",
        summary: "Checkout failure",
        context: { environment: "test", attempts: 2 },
      },
    });
  });

  it.each([
    [{ commandId: "command-3", content: "   " }, "MANUAL_CONTENT_REQUIRED"],
    [{ commandId: "   ", content: "Payment route fails" }, "MANUAL_COMMAND_ID_REQUIRED"],
  ] as const)("rejects invalid raw data with %s", async (rawData, code) => {
    await expect(adapter().adapt(rawData)).rejects.toThrow(code);
  });

  it("derives a stable input key from the command ID", async () => {
    const first = await adapter().adapt({ commandId: "same-command", content: "First delivery" });
    const second = await adapter().adapt({ commandId: "same-command", content: "Redelivery" });
    expect([first.inputKey, second.inputKey]).toEqual(["same-command", "same-command"]);
    expect(first.groupKey).toBeUndefined();
  });
});
