import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Jeton d'accès au serveur de collaboration temps réel (Yjs) d'un document.
 *
 * Le jeton est émis par la fonction serveur `getCollabTokenFn` du module Docs
 * (session vérifiée + rôle effectif) puis vérifié par `apps/collab`, qui ne
 * dépend ni de la base ni de l'application : uniquement de ce fichier et du
 * secret d'instance. Sans serveur configuré, il n'est jamais émis et le client
 * conserve l'autosave existant.
 */
export type CollabTokenPayload = {
  fileId: string;
  userId: string;
  name: string;
  canWrite: boolean;
  /** Expiration, en millisecondes depuis l'époque Unix. */
  exp: number;
};

/** Durée de vie d'un jeton de collaboration (2 h) : le client le renouvelle. */
export const COLLAB_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/** Bornes défensives : au-delà, le jeton ne peut pas être légitime. */
const MAX_TOKEN_LENGTH = 4 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 255;

const VERSION = "v1";

/** Signature HMAC-SHA256, encodée en base64url (sans remplissage). */
function sign(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

/**
 * Signe un jeton `v1.<charge utile base64url>.<signature base64url>`.
 *
 * Le champ signé est la chaîne `v1.<charge utile>` (version incluse), ce qui
 * protège aussi le préfixe de version contre une réécriture.
 */
export function signCollabToken(payload: CollabTokenPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const body = `${VERSION}.${encoded}`;
  return `${body}.${sign(secret, body).toString("base64url")}`;
}

/** Validation structurelle de la charge utile décodée. */
function isCollabTokenPayload(value: unknown): value is CollabTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.fileId === "string" &&
    payload.fileId.length > 0 &&
    payload.fileId.length <= MAX_ID_LENGTH &&
    typeof payload.userId === "string" &&
    payload.userId.length > 0 &&
    payload.userId.length <= MAX_ID_LENGTH &&
    typeof payload.name === "string" &&
    payload.name.length <= MAX_NAME_LENGTH &&
    typeof payload.canWrite === "boolean" &&
    typeof payload.exp === "number" &&
    Number.isFinite(payload.exp)
  );
}

/**
 * Vérifie un jeton et retourne sa charge utile, ou `null` si le jeton est
 * malformé, mal signé ou expiré (comparaison à temps constant).
 *
 * `now` (millisecondes) est injectable pour les tests.
 */
export function verifyCollabToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): CollabTokenPayload | null {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, encoded, signature] = parts;
  if (version !== VERSION || !encoded || !signature) return null;

  const expected = sign(secret, `${version}.${encoded}`);
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isCollabTokenPayload(parsed)) return null;
  if (parsed.exp <= now) return null;

  return parsed;
}
