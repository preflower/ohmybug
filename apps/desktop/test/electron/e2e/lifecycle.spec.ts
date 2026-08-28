import { expect, test } from "./electron-fixture.js";

test("hides a closed window and restores it without stopping the desktop runtime", async ({ desktop }) => {
  await desktop.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });

  await expect.poll(() => desktop.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.isVisible() ?? false
  )).toBe(false);

  expect(await desktop.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.isDestroyed() ?? true
  )).toBe(false);

  await desktop.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.show();
    BrowserWindow.getAllWindows()[0]?.focus();
  });
  await expect.poll(() => desktop.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.isVisible() ?? false
  )).toBe(true);
  await expect(desktop.page.getByText("Oh My Bug ?!").first()).toBeVisible();
});
