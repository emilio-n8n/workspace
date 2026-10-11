import { getServerEnv } from "./env.ts";

/** Toutes les applications de la suite (registre partagé `@workspace/ui`). */
export type SuiteAppKey =
  | "home"
  | "drive"
  | "docs"
  | "sheets"
  | "slides"
  | "calendar"
  | "tasks"
  | "forms"
  | "mail"
  | "chat"
  | "meet"
  | "sites"
  | "classroom"
  | "admin";

const DEV_PORTS: Record<SuiteAppKey, number> = {
  home: 3000,
  drive: 3001,
  docs: 3002,
  tasks: 3003,
  calendar: 3004,
  forms: 3005,
  sheets: 3006,
  slides: 3007,
  mail: 3008,
  chat: 3009,
  meet: 3010,
  sites: 3011,
  classroom: 3012,
  admin: 3013,
};

/**
 * URLs publiques des applications de la suite.
 *
 * - Développement (host localhost) : même hôte, ports 3000-3013 — les cookies
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

  const overrides: Partial<Record<SuiteAppKey, string | undefined>> = {
    drive: env.DRIVE_URL,
    docs: env.DOCS_URL,
    tasks: env.TASKS_URL,
    calendar: env.CALENDAR_URL,
    forms: env.FORMS_URL,
    sheets: env.SHEETS_URL,
    slides: env.SLIDES_URL,
    mail: env.MAIL_URL,
    chat: env.CHAT_URL,
    meet: env.MEET_URL,
    sites: env.SITES_URL,
    classroom: env.CLASSROOM_URL,
    admin: env.ADMIN_URL,
  };

  const resolve = (key: SuiteAppKey): string => {
    const explicit = overrides[key];
    if (explicit) return explicit;
    if (isLocal) return `http://localhost:${DEV_PORTS[key]}`;
    if (key === "home") return home;
    return `${parsed.protocol}//${key}.${baseHost}`;
  };

  const urls = {} as Record<SuiteAppKey, string>;
  for (const key of Object.keys(DEV_PORTS) as SuiteAppKey[]) {
    urls[key] = resolve(key);
  }
  return urls;
}
