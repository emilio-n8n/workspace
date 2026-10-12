import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb, schema } from "@workspace/database";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { isWorkspaceScope, type WorkspaceScope } from "./scopes.ts";

/**
 * Jetons d'API / MCP (ADR-0006).
 *
 * Propriétés de sécurité :
 * - Le secret n'est affiché qu'à l'émission ; seule son empreinte SHA-256 est
 *   stockée (`api_tokens.token_hash`), jamais le clair — ni en base ni en
 *   journal.
 * - L'authentification filtre d'abord en SQL (empreinte, révocation,
 *   expiration) puis compare l'empreinte en temps constant
 *   (`timingSafeEqual`), défense en profondeur.
 * - `lastUsedAt` est mis à jour au plus une fois toutes les 5 minutes : pas
 *   d'écriture à chaque requête d'agent (MCP, intégration).
 * - Les scopes sont validés à l'émission contre `WORKSPACE_SCOPES`
 *   (`isWorkspaceScope`) et l'accès est refusé par défaut (`tokenHasScope`).
 * - Expiration : 90 jours par défaut (voir `API_TOKEN_DEFAULT_TTL_MS`) ;
 *   `expiresAt: null` émet volontairement un jeton sans expiration
 *   (échappatoire explicite, à éviter).
 */
const { apiTokens } = schema;

/** Préfixe visible des jetons Workspace. */
export const TOKEN_PREFIX = "wsk_";

/** Expiration par défaut d'un jeton d'API : 90 jours, en millisecondes. */
export const API_TOKEN_DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type IssuedApiToken = {
  id: string;
  /** Valeur en clair — montrée UNE SEULE FOIS, jamais stockée ni journalisée. */
  token: string;
  prefix: string;
};

export type ApiTokenListItem = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type TokenPrincipal = {
  tokenId: string;
  userId: string;
  orgId: string;
  scopes: string[];
};

/**
 * Émet un jeton scoped pour (utilisateur, organisation).
 * Le jeton n'est retourné qu'ici ; seul son SHA-256 est stocké.
 * `expiresAt` omis → expiration par défaut à 90 jours ; `expiresAt: null`
 * → jeton sans expiration (échappatoire explicite, déconseillée).
 */
export async function issueApiToken(input: {
  userId: string;
  orgId: string;
  name: string;
  scopes: readonly WorkspaceScope[];
  expiresAt?: Date | null;
}): Promise<IssuedApiToken> {
  for (const scope of input.scopes) {
    if (!isWorkspaceScope(scope)) {
      throw new Error(`Scope inconnu : ${scope}`);
    }
  }

  const secret = randomBytes(32).toString("base64url");
  const token = `${TOKEN_PREFIX}${secret}`;
  const prefix = `${TOKEN_PREFIX}${secret.slice(0, 6)}…`;

  // Jamais d'expiration infinie par défaut : un jeton oublié reste borné à
  // 90 jours. Seul un `expiresAt: null` explicite (échappatoire) l'évite.
  const expiresAt =
    input.expiresAt === undefined
      ? new Date(Date.now() + API_TOKEN_DEFAULT_TTL_MS)
      : input.expiresAt;

  const db = getDb();
  const [row] = await db
    .insert(apiTokens)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      name: input.name,
      prefix,
      tokenHash: hashToken(token),
      scopes: [...input.scopes],
      expiresAt,
    })
    .returning({ id: apiTokens.id });

  if (!row) throw new Error("Émission du jeton impossible.");

  return { id: row.id, token, prefix };
}

/** Jetons d'un utilisateur (hash exclu de la projection). */
export async function listApiTokens(userId: string, orgId: string): Promise<ApiTokenListItem[]> {
  const db = getDb();
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), eq(apiTokens.orgId, orgId)))
    .orderBy(desc(apiTokens.createdAt));
}

/** Révoque un jeton (uniquement celui de l'utilisateur donné). */
export async function revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)),
    )
    .returning({ id: apiTokens.id });
  return rows.length > 0;
}

/**
 * Authentifie un jeton présenté par un agent (MCP, intégration).
 * Retourne le principal complet, ou null si le jeton est inconnu,
 * révoqué ou expiré. Met à jour `lastUsedAt`.
 */
export async function authenticateApiToken(token: string): Promise<TokenPrincipal | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length < TOKEN_PREFIX.length + 16) return null;

  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(token)),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Comparaison en temps constant (défense en profondeur).
  const expected = Buffer.from(row.tokenHash, "hex");
  const actual = Buffer.from(hashToken(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  // Mise à jour throttlée (5 min) : évite une écriture à chaque requête MCP.
  await db
    .update(apiTokens)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiTokens.id, row.id),
        sql`coalesce(${apiTokens.lastUsedAt}, to_timestamp(0)) < now() - interval '5 minutes'`,
      ),
    );

  return { tokenId: row.id, userId: row.userId, orgId: row.orgId, scopes: row.scopes };
}

/** Vérifie qu'un principal possède un scope requis (refus par défaut). */
export function tokenHasScope(principal: TokenPrincipal, scope: WorkspaceScope): boolean {
  return principal.scopes.includes(scope);
}
