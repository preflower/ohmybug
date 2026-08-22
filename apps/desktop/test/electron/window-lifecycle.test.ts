import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { installWindowLifecycle } from "../../src/electron/window-lifecycle.js";

describe("Electron window lifecycle", () => {
  it("hides on close while background work continues and closes only during explicit Quit", () => {
    const window = Object.assign(new EventEmitter(), {
      hide: vi.fn(),
      show: vi.fn()
    });
    let quitting = false;
    installWindowLifecycle(window, () => quitting);

    const backgroundClose = { preventDefault: vi.fn() };
    window.emit("close", backgroundClose);
    expect(backgroundClose.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();

    quitting = true;
    const explicitClose = { preventDefault: vi.fn() };
    window.emit("close", explicitClose);
    expect(explicitClose.preventDefault).not.toHaveBeenCalled();
  });

  it("shows the window only after its renderer is ready", () => {
    const window = Object.assign(new EventEmitter(), {
      hide: vi.fn(),
      show: vi.fn()
    });
    installWindowLifecycle(window, () => false);
    window.emit("ready-to-show");
    expect(window.show).toHaveBeenCalledOnce();
  });
});
