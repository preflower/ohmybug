import { expect, test } from "./electron-fixture.js";

test("persists explicit themes and follows OS changes in system mode", async ({ desktop }) => {
  await desktop.page.emulateMedia({ colorScheme: "light" });
  await desktop.page.getByRole("link", { name: "Settings" }).click();
  await expect(desktop.page.locator("html")).toHaveAttribute("data-theme", "light");

  await desktop.page.getByRole("button", { name: "深色" }).click();
  await expect(desktop.page.locator("html")).toHaveAttribute("data-theme", "dark");
  await desktop.page.reload();
  await expect(desktop.page.locator("html")).toHaveAttribute("data-theme", "dark");

  await desktop.page.getByRole("link", { name: "Settings" }).click();
  await desktop.page.getByRole("button", { name: "跟随系统" }).click();
  await desktop.page.emulateMedia({ colorScheme: "dark" });
  await expect(desktop.page.locator("html")).toHaveAttribute("data-theme", "dark");
});
