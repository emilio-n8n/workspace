/**
 * Type de compte (espace) choisi à l'inscription — module pur, sans instance
 * better-auth : importable par les services de modules et les tests.
 */
export type AccountKind = "personal" | "business" | "education";

/**
 * Lit le type de compte dans la méta d'organisation (texte JSON en base).
 * Indéfini si la méta est absente ou illisible : les anciens espaces gardent
 * alors la totalité de la suite (aucune app n'est retirée par défaut).
 */
export function parseAccountKind(metadata: unknown): AccountKind | undefined {
  let source: unknown = metadata;
  if (typeof metadata === "string") {
    try {
      source = JSON.parse(metadata);
    } catch {
      // Méta non-JSON : aucune décision possible, on retombe sur le défaut.
      return undefined;
    }
  }
  if (!source || typeof source !== "object") return undefined;
  const kind = (source as { kind?: unknown }).kind;
  if (kind === "personal" || kind === "business" || kind === "education") return kind;
  return undefined;
}

/**
 * Comptes gérés (créés par un administrateur) : réservés aux espaces
 * entreprise et éducation. Un espace personnel n'a pas d'administration de
 * comptes ; un espace ancien (type inconnu) garde le comportement historique.
 */
export function allowsManagedAccounts(kind: AccountKind | undefined): boolean {
  return kind !== "personal";
}
