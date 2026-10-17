import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout (navigateur réel) sur l'ensemble de la suite :
 * 14 applications sur localhost:3000-3013. Le SSO fonctionne sans
 * configuration : les cookies de session ignorent les ports.
 */
/** Applications de la suite, dans l'ordre des ports 3000-3013. */
const APPS = [
  "home",
  "drive",
  "docs",
  "tasks",
  "calendar",
  "forms",
  "sheets",
  "slides",
  "mail",
  "chat",
  "meet",
  "sites",
  "classroom",
  "admin",
] as const;

/**
 * Sous-ensemble facultatif (machines à mémoire limitée) :
 * E2E_APPS=home,chat pnpm test:e2e e2e/suite-phase4-5.spec.ts
 */
const ONLY = process.env.E2E_APPS ? new Set(process.env.E2E_APPS.split(",")) : null;

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
    // Chromium système facultatif (ex. machines ARM sans build Playwright) :
    // PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  },
  webServer: APPS.filter((app) => !ONLY || ONLY.has(app)).map((app) => ({
    command: `pnpm --filter @app/${app} dev`,
    url: `http://localhost:${3000 + APPS.indexOf(app)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Sans le bouton flottant des TanStack Devtools, qui interceptait les
    // clics en bas à droite (cause réelle de l'échec du parcours Chat).
    env: { VITE_DEVTOOLS: "off" },
  })),
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
