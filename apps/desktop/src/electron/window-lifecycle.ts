interface CloseEventLike {
  preventDefault(): void;
}

interface LifecycleWindow {
  on(event: "close", listener: (event: CloseEventLike) => void): unknown;
  on(event: "ready-to-show", listener: () => void): unknown;
  hide(): void;
  show(): void;
}

export function installWindowLifecycle(window: LifecycleWindow, isQuitting: () => boolean): void {
  window.on("close", (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    window.hide();
  });
  window.on("ready-to-show", () => window.show());
}
