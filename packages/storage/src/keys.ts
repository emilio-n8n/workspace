/** Validation et construction des clés de stockage (sécurité : anti-traversal). */

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/;

export class InvalidStorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStorageKeyError";
  }
}

/** Valide une clé : caractères autorisés, aucun composant `..`, longueur bornée. */
export function assertValidKey(key: string): void {
  if (!key || key.length > 512 || !KEY_PATTERN.test(key)) {
    throw new InvalidStorageKeyError(`Clé de stockage invalide : ${String(key)}`);
  }
  const parts = key.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new InvalidStorageKeyError(`Clé de stockage avec composant interdit : ${String(key)}`);
  }
}

/** Chemin relatif sécurisé pour le stockage local (clé déjà validée). */
export function keyToRelativePath(key: string): string {
  assertValidKey(key);
  return key;
}

function sanitizeSegment(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/-+\./g, ".")
    .replace(/^-+|(-+)$/g, "")
    .slice(0, 80);
}

/**
 * Construit une clé sous le préfixe d'organisation.
 * Ex. : orgs/<orgId>/<id>/<nom-assaini> — le nom est facultatif et décoratif.
 */
export function orgKey(orgId: string, id: string, name?: string): string {
  const orgSegment = sanitizeSegment(orgId);
  const idSegment = sanitizeSegment(id);
  const base = `orgs/${orgSegment}/${idSegment}`;
  return name ? `${base}/${sanitizeSegment(name)}` : base;
}
