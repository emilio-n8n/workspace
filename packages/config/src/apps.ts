import { getServerEnv } from "./env.ts";

export type SuiteAppKey = "home" | "drive" | "docs" | "tasks";

const DEV_PORTS: Record<SuiteAppKey, number> = {
  home: 3000,
  drive: 3001,
  docs: 3002,
  tasks: 3003,
};

/**
 * URLs publiques des applications de la suite.
 *
 * - Développement (host localhost) : même hôte, ports 3000-3003 — les cookies
 *   de session ignorent les ports, le SSO fonctionne sans configuration.
 * - Production : surcharges explicites (*_URL) sinon sous-domaines dérivés de
 *   PUBLIC_URL (ex. https://drive.exemple.org). Le cookie de session doit être
 *   partagé entre sous-domaines via BETTER_AUTH_COOKIE_DOMAIN.
 */
export function getAppUrls(): Record<SuiteAppKey, string> {
  const env = getServerEnv();
  const home = env.PUBLIC_URL;
  const parsed = new URL(home);
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const baseHost = parsed.hostname.replace(/^(app|www)\./, "");

  const resolve = (key: SuiteAppKey, explicit?: string): string => {
    if (explicit) return explicit;
    if (isLocal) return `http://localhost:${DEV_PORTS[key]}`;
    if (key === "home") return home;
    return `${parsed.protocol}//${key}.${baseHost}`;
  };

  return {
    home: resolve("home"),
    drive: resolve("drive", env.DRIVE_URL),
    docs: resolve("docs", env.DOCS_URL),
    tasks: resolve("tasks", env.TASKS_URL),
  };
}
