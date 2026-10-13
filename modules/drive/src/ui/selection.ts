/**
 * Sélection multiple : bascule, plage au clavier, tout sélectionner, purge des
 * identifiants disparus, et filtrage des fichiers téléchargeables d'une sélection.
 *
 * Fonctions pures (test/selection.test.ts) : le composant se contente de rendre
 * le résultat.
 */

import { isLinkedMime } from "./linked-files.ts";

/** Sélection courante : identifiants retenus et point d'ancrage des plages. */
export type Selection = {
  ids: ReadonlySet<string>;
  /** Dernière ligne cliquée sans modificateur : borne de départ des plages Maj. */
  anchorId: string | null;
};

export const EMPTY_SELECTION: Selection = { ids: new Set(), anchorId: null };

/**
 * Bascule un identifiant. C'est le geste du Ctrl/⌘ + clic : il ne touche pas
 * au reste de la sélection.
 */
export function toggleSelection(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Retire un identifiant en conservant les autres : cliquer une ligne déjà
 * sélectionnée la désélectionne sans casser le reste du lot.
 */
export function deselectId(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}

/**
 * Sélectionne la plage comprise entre l'ancrage et la ligne visée (inclus).
 * Sans ancrage valide — ou si l'ancrage n'est plus dans la liste — seule la
 * ligne visée est retenue.
 */
export function selectRange(
  anchorId: string | null,
  targetId: string,
  orderedIds: readonly string[],
): Set<string> {
  const anchorIndex = anchorId === null ? -1 : orderedIds.indexOf(anchorId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (anchorIndex === -1 || targetIndex === -1) return new Set([targetId]);

  const from = Math.min(anchorIndex, targetIndex);
  const to = Math.max(anchorIndex, targetIndex);
  return new Set(orderedIds.slice(from, to + 1));
}

/** Sélectionne toutes les lignes visibles. */
export function selectAllIds(orderedIds: readonly string[]): Set<string> {
  return new Set(orderedIds);
}

/**
 * Ne conserve que les identifiants encore présents : une ligne supprimée,
 * déplacée ou filtrée ne doit pas rester sélectionnée en fantôme.
 */
export function pruneSelection(
  ids: ReadonlySet<string>,
  orderedIds: readonly string[],
): Set<string> {
  const available = new Set(orderedIds);
  return new Set([...ids].filter((id) => available.has(id)));
}

/** Nombre d'éléments sélectionnés, en français accordé. */
export function selectionLabel(count: number): string {
  if (count <= 0) return "Aucun élément sélectionné";
  return count === 1 ? "1 élément sélectionné" : `${count} éléments sélectionnés`;
}

/** Champs requis pour juger un élément téléchargeable. */
export type DownloadableEntry = {
  id: string;
  kind: "folder" | "file";
  mimeType: string | null;
};

/**
 * Éléments téléchargeables d'une sélection : les fichiers réels seulement.
 * Les dossiers n'ont pas de contenu à récupérer et les fichiers liés s'ouvrent
 * dans leur application (Docs, Sheets, Slides, Forms).
 */
export function downloadableEntries<T extends DownloadableEntry>(entries: readonly T[]): T[] {
  return entries.filter((entry) => entry.kind === "file" && !isLinkedMime(entry.mimeType));
}

/** Nombre d'éléments d'une sélection qui ne peuvent pas être téléchargés. */
export function undownloadableCount(entries: readonly DownloadableEntry[]): number {
  return entries.length - downloadableEntries(entries).length;
}
