import { getAppUrls, getServerEnv } from "@workspace/config";
import { getDb, schema } from "@workspace/database";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

/**
 * Instance better-auth du projet.
 *
 * - Stockage : notre PostgreSQL via l'adaptateur Drizzle (schéma généré dans
 *   `@workspace/database/src/schema/auth.ts`, versionné comme toute migration).
 * - Sessions : cookies httpOnly, rotation, révocation (voir ADR-0003).
 * - Organisations : plugin organization + équipes (groupes de partage).
 * - Autorisation : PAS ici — elle vit dans `packages/permissions` (ADR-0004).
 */
export function createAuth() {
  const env = getServerEnv();

  return betterAuth({
    baseURL: env.PUBLIC_URL,
    secret: env.SESSION_SECRET,
    // Toutes les applications de la suite sont des origines de confiance :
    // le gestionnaire better-auth est monté sur chacune (SSO multi-apps).
    trustedOrigins: [env.PUBLIC_URL, ...Object.values(getAppUrls())],
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
    },
    plugins: [organization({ teams: { enabled: true } })],
    // Production multi-apps : cookie de session partagé entre sous-domaines.
    ...(env.BETTER_AUTH_COOKIE_DOMAIN
      ? {
          advanced: {
            crossSubDomainCookies: {
              enabled: true,
              domain: env.BETTER_AUTH_COOKIE_DOMAIN,
            },
          },
        }
      : {}),
  });
}

export const auth = createAuth();
export type Auth = typeof auth;
