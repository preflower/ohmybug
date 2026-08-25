import { describe, expect, it, vi } from "vitest";

import { TrayNavigationQueue } from "../../src/electron/tray-navigation.js";

describe("tray navigation queue", () => {
  it("delivers only after ready and retains the latest pending target", () => {
    const send = vi.fn();
    const queue = new TrayNavigationQueue(send);

    queue.request({ issueId: "issue-1" });
    queue.request({ issueId: "issue-2" });
    expect(send).not.toHaveBeenCalled();

    queue.setReady(true);
    expect(send).toHaveBeenCalledWith({ issueId: "issue-2" });
    queue.request({ issueId: "issue-ready" });
    expect(send).toHaveBeenLastCalledWith({ issueId: "issue-ready" });
    queue.request({});
    expect(send).toHaveBeenLastCalledWith({});

    queue.setReady(false);
    queue.request({ issueId: "issue-3" });
    expect(send).toHaveBeenCalledTimes(3);
  });
});
