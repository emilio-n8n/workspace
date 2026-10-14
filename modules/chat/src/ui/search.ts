import { foldText, foldWithMap } from "./text.ts";

/**
 * Recherche dans le canal courant : filtre par texte et par auteur, bornes des
 * correspondances pour le surlignage, et navigation circulaire entre résultats.
 *
 * La recherche est tolérante à la casse et aux accents, et porte sur le corps
 * du message (le nom de l'auteur se filtre par le sélecteur dédié).
 */

/** Message minimal nécessaire à la recherche (MessageView en est un sur-ensemble). */
export type SearchableMessage = {
  id: string;
  body: string;
  authorId: string;
};

export type SearchFilters = {
  /** Texte recherché ; vide = pas de filtre sur le corps. */
  query: string;
  /** Auteur retenu, ou `null` pour tous les membres. */
  authorId: string | null;
};

/** Borne de la copie affichée d'un message (le corps reste intact). */
export type MatchRange = [start: number, end: number];

/** Morceau de message : texte brut ou correspondance à surligner. */
export type SearchSegment = {
  text: string;
  match: boolean;
};

/** Filtre de recherche vide : tout est retenu. */
export const EMPTY_FILTERS: SearchFilters = { query: "", authorId: null };

/** Vrai si les deux filtres sont vides (rien à filtrer, rien à afficher). */
export function hasActiveFilters(filters: SearchFilters): boolean {
  return filters.query.trim().length > 0 || filters.authorId !== null;
}

/** Vrai si un message satisfait les deux filtres. */
export function matchesFilters(message: SearchableMessage, filters: SearchFilters): boolean {
  if (filters.authorId !== null && message.authorId !== filters.authorId) return false;
  const query = filters.query.trim();
  if (query.length === 0) return true;
  return foldText(message.body).includes(foldText(query));
}

/** Messages retenus, dans l'ordre du fil (l'ordre d'affichage est préservé). */
export function searchMessages<T extends SearchableMessage>(
  messages: readonly T[],
  filters: SearchFilters,
): T[] {
  return messages.filter((message) => matchesFilters(message, filters));
}

/**
 * Bornes de toutes les correspondances d'une requête dans un corps de message,
 * sans chevauchement. La correspondance est cherchée dans le texte replié puis
 * reportée sur le texte d'origine : un accent ne décale jamais le surlignage.
 */
export function matchRanges(body: string, query: string): MatchRange[] {
  const needle = foldText(query.trim());
  if (needle.length === 0) return [];
  const { folded, map } = foldWithMap(body);
  const ranges: MatchRange[] = [];
  let from = 0;
  while (from <= folded.length - needle.length) {
    const at = folded.indexOf(needle, from);
    if (at < 0) break;
    const start = map[at] ?? 0;
    const last = at + needle.length - 1;
    const end = (map[last] ?? start) + 1;
    ranges.push([start, Math.max(end, start + 1)]);
    from = at + needle.length;
  }
  return ranges;
}

/** Découpe un message en texte brut et correspondances, dans l'ordre. */
export function highlightSegments(body: string, ranges: readonly MatchRange[]): SearchSegment[] {
  if (ranges.length === 0) return [{ text: body, match: false }];
  const ordered = [...ranges].sort((a, b) => a[0] - b[0]);
  const segments: SearchSegment[] = [];
  let cursor = 0;
  for (const [start, end] of ordered) {
    if (start < cursor) continue; // chevauchement : déjà surligné
    if (start > cursor) segments.push({ text: body.slice(cursor, start), match: false });
    segments.push({ text: body.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < body.length) segments.push({ text: body.slice(cursor), match: false });
  return segments;
}

/**
 * Déplace le curseur de résultats de `delta` rangs, en bouclant sur les extrémités.
 * `-1` (aucun résultat) reste `-1` : il n'y a alors rien à visiter.
 */
export function stepIndex(current: number, total: number, delta: number): number {
  if (total <= 0) return -1;
  const base = current < 0 || current >= total ? (delta >= 0 ? -1 : total) : current;
  return (base + delta + total) % total;
}

/** Compteur « 3 / 12 » : `null` quand il n'y a aucun résultat à compter. */
export function resultCounter(current: number, total: number): string | null {
  if (total <= 0) return null;
  return `${current + 1} / ${total}`;
}

/**
 * Annonce des résultats pour les lecteurs d'écran. Le décompte change à chaque
 * frappe : il est énoncé tel quel, le focus reste dans le champ de recherche.
 */
export function formatResultAnnouncement(
  total: number,
  query: string,
  authorName: string | null,
): string {
  if (total === 0) {
    return authorName
      ? `Aucun message de ${authorName} ne correspond à « ${query} ».`
      : `Aucun message ne correspond à « ${query} ».`;
  }
  const scope = authorName ? ` de ${authorName}` : "";
  return total === 1
    ? `1 message${scope} trouvé pour « ${query} ».`
    : `${total} messages${scope} trouvés pour « ${query} ».`;
}
