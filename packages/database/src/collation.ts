/**
 * Tri alphabétique français indépendant de la collation de la base.
 *
 * `ORDER BY name` dépend de la collation du cluster PostgreSQL : en `C` /
 * `C.UTF-8` (défaut de nombreux hébergeurs), « À relire » passe après
 * « Clients ». Les listes affichées (étiquettes, membres) sont donc triées ici.
 */
const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export function compareFr(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Copie triée de `rows` selon `key(row)`, en ordre alphabétique français. */
export function sortFr<T>(rows: readonly T[], key: (row: T) => string): T[] {
  return [...rows].sort((left, right) => collator.compare(key(left), key(right)));
}
