import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  installTrayMenuEvents,
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
const icons = {
  failure: { name: "red" },
  review: { name: "yellow" },
  processing: { name: "blue" },
} as const;
type TestIcon = (typeof icons)[keyof typeof icons];

function setup(loadIssues = vi.fn(async () => [review, repairing])) {
  let template: TrayMenuEntry<TestIcon>[] = [];
  const menu = { native: true };
  const options = {
    loadIssues,
    resolveTaskIcon: vi.fn((indicator: keyof typeof icons): TestIcon | undefined => icons[indicator]),
    buildMenu: vi.fn((next: TrayMenuEntry<TestIcon>[]) => {
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
  it("opens the same task menu for primary and context clicks", () => {
    const tray = new EventEmitter();
    const controller = { open: vi.fn(async () => undefined) };

    installTrayMenuEvents(tray, controller);
    tray.emit("click");
    tray.emit("right-click");

    expect(controller.open).toHaveBeenCalledTimes(2);
  });

  it("builds two bounded task groups and dispatches row actions", async () => {
    const fixture = setup();
    await fixture.controller.open();

    expect(fixture.template.map((item) => item.label ?? item.type)).toEqual([
      "需要你操作 (1)",
      "CHK-1 · Review checkout",
      "separator",
      "AI 处理中 (1)",
      "CHK-2 · Repair checkout",
      "separator",
      "打开全部 Issues",
      "退出 Oh My Bug",
    ]);
    expect(fixture.template[1]?.icon).toBe(icons.review);
    expect(fixture.template[4]?.icon).toBe(icons.processing);
    expect(fixture.options.resolveTaskIcon.mock.calls.map(([indicator]) => indicator)).toEqual([
      "review",
      "processing",
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
      "CHK-6 · Review checkout",
      "CHK-5 · Review checkout",
      "CHK-4 · Review checkout",
      "CHK-3 · Review checkout",
      "还有 2 条…",
      "separator",
      "打开全部 Issues",
      "退出 Oh My Bug",
    ]);
    fixture.template[5]?.click?.();
    expect(fixture.options.openAll).toHaveBeenCalledOnce();
  });

  it("uses the failure icon without changing the row action", async () => {
    const fixture = setup(vi.fn(async () => [{ ...review, status: "REPAIR_FAILED" as const }]));
    await fixture.controller.open();

    expect(fixture.template[1]?.icon).toBe(icons.failure);
    fixture.template[1]?.click?.();
    expect(fixture.options.openIssue).toHaveBeenCalledWith("issue-1");
  });

  it("keeps a text-only task usable when no icon resolves", async () => {
    const fixture = setup();
    fixture.options.resolveTaskIcon.mockReturnValue(undefined);
    await fixture.controller.open();

    expect(fixture.template[1]?.icon).toBeUndefined();
    fixture.template[1]?.click?.();
    expect(fixture.options.openIssue).toHaveBeenCalledWith("issue-1");
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
