import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/electron/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  }
});
