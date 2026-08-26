import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.OH_MY_BUG_E2E_PORT ?? 5173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: `pnpm --filter @oh-my-bug/desktop dev:renderer -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: true
  }
});
