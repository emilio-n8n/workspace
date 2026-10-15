/**
 * Historique annuler / rétablir : une pile bornée d'instantanés.
 *
 * L'éditeur capture l'état complet (scène + sélection + réglages) avant chaque
 * action ; annuler remet l'instantané précédent. La pile est volontairement
 * simple et pure : `commit` n'ajoute rien si rien ne change, et toute nouvelle
 * action vide la branche « rétablir » (comme dans tout vrai outil).
 *
 * Logique pure (aucune dépendance) : l'éditeur l'utilise, les tests la
 * vérifient.
 */

export type HistoryState<T> = {
  /** États précédents, du plus ancien au plus récent. */
  past: readonly T[];
  present: T;
  /** États rendus disponibles par un annuler, du plus proche au plus lointain. */
  future: readonly T[];
};

/** Au-delà, les états les plus anciens sont oubliés (mémoire bornée). */
export const HISTORY_LIMIT = 80;

export function createHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}

/** Nouvelle action : l'état courant part dans le passé, « rétablir » se vide. */
export function commit<T>(history: HistoryState<T>, next: T): HistoryState<T> {
  if (Object.is(next, history.present)) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

export function canUndo<T>(history: HistoryState<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: HistoryState<T>): boolean {
  return history.future.length > 0;
}

/** Annule : sans passé, l'historique est rendu tel quel (jamais d'exception). */
export function undo<T>(history: HistoryState<T>): HistoryState<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

/** Rétablit : sans futur, l'historique est rendu tel quel. */
export function redo<T>(history: HistoryState<T>): HistoryState<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: rest,
  };
}
