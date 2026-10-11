import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout (navigateur réel) sur l'ensemble de la suite :
 * accueil (3000), Drive (3001), Docs (3002), Tasks (3003).
 * Le SSO fonctionne sans configuration : les cookies ignorent les ports.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  },
  webServer: [
    {
      command: "pnpm --filter @app/home dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @app/drive dev",
      url: "http://localhost:3001",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @app/docs dev",
      url: "http://localhost:3002",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @app/tasks dev",
      url: "http://localhost:3003",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
