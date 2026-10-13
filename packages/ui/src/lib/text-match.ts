/** Minuscules sans diacritiques, pour comparer sans se soucier des accents. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Vrai si `label` commence par `query` — comparaison tolérante à la casse et
 * aux accents (ex. « eteint » trouve « Éteint »). Utilisée par la recherche
 * frappée des primitifs à liste (Select, Menu).
 */
export function startsWithQuery(label: string, query: string): boolean {
  return normalize(label).startsWith(normalize(query));
}
