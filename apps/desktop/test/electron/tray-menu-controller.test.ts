import { describe, expect, it, vi } from "vitest";

import {
  TrayMenuController,
  type TrayMenuEntry,
} from "../../src/electron/tray-menu-controller.js";

const review = {
  id: "issue-1",
  identifier: "CHK-1",
  title: "Review checkout",
  status: "ASSESSMENT_REVIEW" as const,
  updatedAt: "2026-08-25T10:00:00.000Z",
};
const repairing = {
  id: "issue-2",
  identifier: "CHK-2",
  title: "Repair checkout",
  status: "REPAIRING" as const,
  updatedAt: "2026-08-25T11:00:00.000Z",
};

function setup(loadIssues = vi.fn(async () => [review, repairing])) {
  let template: TrayMenuEntry[] = [];
  const menu = { native: true };
  const options = {
    loadIssues,
    buildMenu: vi.fn((next: TrayMenuEntry[]) => {
      template = next;
      return menu;
    }),
    popUp: vi.fn(),
    openIssue: vi.fn(),
    openAll: vi.fn(),
    quit: vi.fn(),
  };
  return {
    controller: new TrayMenuController(options),
    options,
    menu,
    get template() { return template; },
  };
}

describe("tray menu controller", () => {
  it("builds two bounded task groups and dispatches row actions", async () => {
    const fixture = setup();
    await fixture.controller.open();

    expect(fixture.template.map((item) => item.label ?? item.type)).toEqual([
      "需要你操作 (1)",
      "CHK-1 · Review checkout — 待确认判断",
      "separator",
      "AI 处理中 (1)",
      "CHK-2 · Repair checkout — 实现中",
      "separator",
      "打开全部 Issues",
      "退出 Oh My Bug",
    ]);
    fixture.template[1]?.click?.();
    fixture.template.at(-2)?.click?.();
    fixture.template.at(-1)?.click?.();
    expect(fixture.options.openIssue).toHaveBeenCalledWith("issue-1");
    expect(fixture.options.openAll).toHaveBeenCalledOnce();
    expect(fixture.options.quit).toHaveBeenCalledOnce();
    expect(fixture.options.popUp).toHaveBeenCalledWith(fixture.menu);
  });

  it("shows empty and unavailable menus without losing permanent actions", async () => {
    const empty = setup(vi.fn(async () => []));
    await empty.controller.open();
    expect(empty.template.map((item) => item.label ?? item.type)).toEqual([
      "暂无待处理任务",
      "separator",
      "打开全部 Issues",
      "退出 Oh My Bug",
    ]);

    const unavailable = setup(vi.fn(async () => { throw new Error("UTILITY_NOT_READY"); }));
    await unavailable.controller.open();
    expect(unavailable.template.map((item) => item.label ?? item.type)).toEqual([
      "任务列表暂不可用",
      "separator",
      "打开全部 Issues",
      "退出 Oh My Bug",
    ]);
  });

  it("adds one overflow action after the four visible tasks", async () => {
    const fixture = setup(vi.fn(async () => Array.from({ length: 6 }, (_, index) => ({
      ...review,
      id: `issue-${index + 1}`,
      identifier: `CHK-${index + 1}`,
      updatedAt: `2026-08-25T10:0${index}:00.000Z`,
    }))));
    await fixture.controller.open();

    expect(fixture.template.map((item) => item.label ?? item.type)).toEqual([
      "需要你操作 (6)",
      "CHK-6 · Review checkout — 待确认判断",
      "CHK-5 · Review checkout — 待确认判断",
      "CHK-4 · Review checkout — 待确认判断",
      "CHK-3 · Review checkout — 待确认判断",
      "还有 2 条…",
      "separator",
      "打开全部 Issues",
      "退出 Oh My Bug",
    ]);
    fixture.template[5]?.click?.();
    expect(fixture.options.openAll).toHaveBeenCalledOnce();
  });

  it("shares one in-flight load across rapid repeated clicks", async () => {
    let resolve: ((issues: (typeof review)[]) => void) | undefined;
    const load = vi.fn(() => new Promise<(typeof review)[]>((next) => { resolve = next; }));
    const fixture = setup(load);
    const first = fixture.controller.open();
    const second = fixture.controller.open();

    expect(load).toHaveBeenCalledOnce();
    resolve?.([review]);
    await Promise.all([first, second]);
    expect(fixture.options.popUp).toHaveBeenCalledOnce();
  });
});
