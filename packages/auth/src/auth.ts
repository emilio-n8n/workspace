import { getAppUrls, getServerEnv, isProduction } from "@workspace/config";
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

  // En production, une URL locale signale une configuration incomplète : on
  // refuse de démarrer plutôt que de faire confiance à localhost.
  const publicHost = new URL(env.PUBLIC_URL).hostname;
  if (isProduction() && (publicHost === "localhost" || publicHost === "127.0.0.1")) {
    throw new Error("PUBLIC_URL doit être une URL publique en production (localhost interdit).");
  }

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
    rateLimit: { enabled: true, window: 60, max: 100 },
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction(),
      },
      // Production multi-apps : cookie de session partagé entre sous-domaines.
      ...(env.BETTER_AUTH_COOKIE_DOMAIN
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: env.BETTER_AUTH_COOKIE_DOMAIN,
            },
          }
        : {}),
    },
  });
}

export const auth = createAuth();
export type Auth = typeof auth;
