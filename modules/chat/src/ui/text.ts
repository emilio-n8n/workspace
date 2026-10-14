/**
 * Comparaison de texte tolérante à la casse et aux accents — socole commun aux
 * mentions (autocomplétion) et à la recherche (surlignage).
 *
 * `foldText` réduit un texte à sa forme comparable ; `foldWithMap` conserve en
 * plus la correspondance indice replié → indice d'origine, ce qui permet de
 * reporter une correspondance trouvée dans le texte replié sur le texte affiché
 * (un accent ne doit pas décaler le surlignage).
 */

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Minuscules sans diacritiques (ex. « Épinglé » → « epingle »). */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

/**
 * Version repliée de `text` et la table de correspondance. Chaque caractère du
 * résultat pointe vers l'indice du caractère d'origine dont il provient ; les
 * marques diacritiques combinées sont absorbées par leur lettre de base.
 */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  const folded: string[] = [];
  const map: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const base = text[index]?.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase() ?? "";
    for (const character of base) {
      folded.push(character);
      map.push(index);
    }
  }
  return { folded: folded.join(""), map };
}

/** Vrai si `haystack` contient `needle`, accents et casse ignorés. */
export function containsFolded(haystack: string, needle: string): boolean {
  const query = foldText(needle);
  if (query.length === 0) return false;
  return foldText(haystack).includes(query);
}
