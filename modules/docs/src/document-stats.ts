/**
 * Statistiques du document — logique pure, sans React ni DOM.
 *
 * Les compteurs sont volontairement arrondis et jamais calculés sur du HTML :
 * tout part du texte brut exporté (`toPlainText`), la même source que la
 * recherche et l'export Markdown. Une seule vérité, donc un seul comportement
 * à tester.
 */

/** Statistiques affichables d'un document. */
export type DocumentStats = {
  /** Mots séparés par une espace (toute ponctuation collée compte pour un). */
  words: number;
  /** Caractères, espaces comprises. */
  characters: number;
  /** Caractères hors espaces et tabulations. */
  charactersWithoutSpaces: number;
  /** Temps de lecture en minutes, arrondi à l'entier supérieur. */
  readingMinutes: number;
};

/** Vitesse de lecture adulte moyenne, en mots par minute. */
export const WORDS_PER_MINUTE = 200;

/**
 * Découpe un texte en mots : toute suite de caractères non blancs. Ponctuation
 * collée (« l'été », « 42. ») forme un seul mot — convention des traitements de
 * texte, qui ne compte pas les mots d'un lexique mais des unités de lecture.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/** Caractères, espaces comprises. */
export function countCharacters(text: string): number {
  return text.length;
}

/**
 * Caractères hors espaces : retours à la ligne, tabulations et espaces
 * (y compris insécables) sont écartés.
 */
export function countCharactersWithoutSpaces(text: string): number {
  return text.replace(/\s/g, "").length;
}

/**
 * Temps de lecture en minutes : 200 mots/minute, minimum une minute dès qu'il
 * reste un mot (« moins d'une minute » plutôt que « 0 min »).
 */
export function readingMinutes(words: number): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/** Statistiques complètes d'un texte brut. */
export function documentStats(text: string): DocumentStats {
  const words = countWords(text);
  return {
    words,
    characters: countCharacters(text),
    charactersWithoutSpaces: countCharactersWithoutSpaces(text),
    readingMinutes: readingMinutes(words),
  };
}

/**
 * Ligne de statistiques en français : « 142 mots · 856 caractères · 1 min de
 * lecture ». Les accords suivent les quantités (« 1 mot », « 2 mots »).
 */
export function formatStats(stats: DocumentStats): string {
  const mots = `${stats.words} ${stats.words === 1 ? "mot" : "mots"}`;
  const caractères = `${stats.characters} ${stats.characters === 1 ? "caractère" : "caractères"}`;
  return `${mots} · ${caractères} · ${formatReadingTime(stats.readingMinutes)}`;
}

/**
 * Temps de lecture lisible : « moins d'une minute » en dessous d'une minute,
 * « 1 min de lecture » au singulier, « 4 min de lecture » au pluriel.
 */
export function formatReadingTime(minutes: number): string {
  if (minutes <= 0) return "aucune lecture";
  if (minutes === 1) return "1 min de lecture";
  return `${minutes} min de lecture`;
}
