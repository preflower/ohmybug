import { describe, expect, it } from "vitest";

import {
  confirmIssueTitle,
  createIssue,
  provisionalTitle,
  type IntegrationInput,
} from "../../src/index.js";

function input(data: IntegrationInput["data"]): IntegrationInput {
  return {
    id: "input-1",
    integration: "dingtalk",
    inputKey: "message-1",
    rawData: { text: data.content },
    data,
    receivedAt: "2026-08-20T04:00:00.000Z",
  };
}

describe("Issue title policy", () => {
  it("prefers an Integration summary", () => {
    expect(
      provisionalTitle({
        content: "第一行\n第二行",
        summary: "支付页错误",
      }),
    ).toBe("支付页错误");
  });

  it("uses the first content line when summary is absent", () => {
    expect(provisionalTitle({ content: "支付页打不开\n用户无法付款" })).toBe(
      "支付页打不开",
    );
  });

  it("changes to an editable human-confirmed title after review", () => {
    const issue = createIssue({
      id: "issue-1",
      projectId: "project-1",
      identifier: "OMB-1",
      input: input({ content: "支付页打不开" }),
      now: "2026-08-20T04:00:00.000Z",
    });

    expect(
      confirmIssueTitle(issue, {
        assessmentTitle: "支付页无法打开",
        title: "支付页因路由缺失无法打开",
        now: "2026-08-20T04:05:00.000Z",
      }),
    ).toMatchObject({
      title: "支付页因路由缺失无法打开",
      titleSource: "user",
      revision: 2,
    });
  });

  it("records an unchanged approved suggestion as an Assessment title", () => {
    const issue = createIssue({
      id: "issue-1",
      projectId: "project-1",
      identifier: "OMB-1",
      input: input({ content: "支付页打不开" }),
      now: "2026-08-20T04:00:00.000Z",
    });

    expect(
      confirmIssueTitle(issue, {
        assessmentTitle: "支付页无法打开",
        title: "支付页无法打开",
        now: "2026-08-20T04:05:00.000Z",
      }),
    ).toMatchObject({
      title: "支付页无法打开",
      titleSource: "assessment",
    });
  });
});

describe("Issue creation", () => {
  it("creates one received aggregate with the originating input", () => {
    const sourceInput = input({ content: "列表加载失败" });

    expect(
      createIssue({
        id: "issue-2",
        projectId: "project-1",
        identifier: "OMB-2",
        input: sourceInput,
        now: "2026-08-20T04:10:00.000Z",
      }),
    ).toMatchObject({
      id: "issue-2",
      title: "列表加载失败",
      titleSource: "integration",
      status: "RECEIVED",
      inputs: [sourceInput],
      revision: 1,
    });
  });
});
