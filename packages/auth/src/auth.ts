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
 * - Cookies de session : `httpOnly` + `sameSite=lax` (anti-CSRF) + `secure`
 *   en production ; partage inter-sous-domaines via
 *   `BETTER_AUTH_COOKIE_DOMAIN` quand la suite est déployée en multi-apps
 *   (SSO, ADR-0012).
 * - Sessions : 7 jours glissants, rafraîchies au plus une fois par jour,
 *   sans cache cookie — chaque requête relit la ligne `session` en base,
 *   donc révocation, expiration et changement d'organisation active sont
 *   immédiatement effectifs (voir `session` ci-dessous).
 * - Limitation de débit : 100 req/min par IP et par chemin globalement,
 *   plus un garde renforcé sur les entrées par mot de passe (voir
 *   `rateLimit`).
 * - Organisations : plugin organization + équipes (groupes de partage).
 * - Autorisation : PAS ici — elle vit dans `packages/permissions` (ADR-0004).
 */
/**
 * Règles de limitation de débit better-auth.
 *
 * En production : garde strict (3 essais / 30 s sur sign-in/sign-up, 100
 * req/min globalement). Hors production : garde permissif — les adresses
 * partagées (NAT familial, réseau d'entreprise, CI) ne doivent pas bloquer
 * les inscriptions légitimes ; la protection anti-bourrage reste la
 * responsabilité du déploiement (proxy, fail2ban, captcha).
 */
export function authRateLimitOptions(production: boolean) {
  return {
    enabled: true,
    window: 60,
    max: production ? 100 : 2000,
    customRules: production
      ? {
          "/sign-in/email": { window: 30, max: 3 },
          "/sign-up/email": { window: 30, max: 3 },
        }
      : {
          "/sign-in/email": { window: 30, max: 1000 },
          "/sign-up/email": { window: 30, max: 1000 },
        },
  };
}

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
    // Sessions explicites : ne pas dépendre des défauts de better-auth, une
    // montée de version ne doit pas changer la politique sans diff.
    session: {
      // 7 jours (604 800 s) : assez long pour ne pas se reconnecter chaque
      // semaine sur la suite multi-apps (SSO), assez court pour borner la vie
      // d'un cookie volé. 7 jours est le défaut historique de better-auth :
      // figé ici pour qu'il ne dérive pas en silence.
      expiresIn: 60 * 60 * 24 * 7,
      // Rotation glissante : une session utilisée est prolongée de 7 jours,
      // mais au plus UNE écriture par jour et par session (updateAge), donc
      // pas d'écriture à chaque requête. Une session inactive meurt en 7 jours.
      updateAge: 60 * 60 * 24,
      // Pas de cache de session dans un cookie signé : chaque requête relit la
      // ligne `session` en base. Coût assumé : un SELECT `session` par requête
      // authentifiée, acceptable à notre échelle. Bénéfice : révocation,
      // expiration forcée et `activeOrganizationId` persisté par
      // `requireActorContext` (packages/auth/src/server.ts) sont visibles dès
      // la requête suivante.
      cookieCache: { enabled: false },
    },
    plugins: [organization({ teams: { enabled: true } })],
    rateLimit: authRateLimitOptions(isProduction()),
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
