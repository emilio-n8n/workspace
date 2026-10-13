/**
 * Opérations structurelles : insertion et suppression de lignes ou de
 * colonnes. Logique pure (bornes et incidence sur la sélection) pour que les
 * règles soient testables seules ; le décalage des cellules en base suit
 * exactement cette sémantique.
 */

import { MAX_COLS, MAX_ROWS } from "./csv.ts";

export type StructureKind = "row" | "col";
export type StructureMode = "insert" | "delete";

/** Bornes par type d'opération (alignées sur la grille logique). */
export const STRUCTURE_MAX: Record<StructureKind, number> = {
  row: MAX_ROWS,
  col: MAX_COLS,
};

const STRUCTURE_LABEL: Record<StructureKind, string> = { row: "ligne", col: "colonne" };

/** Nombre maximal d'éléments insérés ou supprimés en une seule opération. */
export const STRUCTURE_MAX_COUNT = 100;

export type CellAddress = { row: number; col: number } | null;

/**
 * Contrôle une opération structurelle et renvoie un message français en cas
 * de refus, `null` si l'opération est acceptable.
 *
 * - `index` est la position touchée : pour une insertion, la position du
 *   nouvel élément (donc `max` inclus, qui n'insère rien) ; pour une
 *   suppression, le premier élément retiré.
 * - `count` reste modéré pour qu'une suppression accidentelle ne balaie pas
 *   toute la feuille.
 */
export function checkStructure(
  kind: StructureKind,
  mode: StructureMode,
  index: number,
  count: number,
): string | null {
  const label = STRUCTURE_LABEL[kind];
  const max = STRUCTURE_MAX[kind];
  if (!Number.isInteger(count) || count < 1 || count > STRUCTURE_MAX_COUNT) {
    return `Nombre de ${label}s à ${mode === "insert" ? "insérer" : "supprimer"} entre 1 et ${STRUCTURE_MAX_COUNT}.`;
  }
  if (!Number.isInteger(index) || index < 0) {
    return `Position de la ${label} hors limites.`;
  }
  if (mode === "insert") {
    if (index > max) return `Position de la ${label} hors limites.`;
    return null;
  }
  if (index + count > max) {
    return `Suppression impossible : elle dépasserait les ${max} ${label}s.`;
  }
  return null;
}

/**
 * Position de la cellule active après une opération structurelle : la
 * sélection « suit » la donnée et ne reste jamais orpheline.
 *
 * - insertion avant ou sur la sélection → décalée vers le bas ou la droite ;
 * - suppression d'un bloc qui contient la sélection → report sur la ligne
 *   (ou colonne) précédente, ou sur la suivante si le bloc commence la
 *   feuille ;
 * - suppression d'un bloc après la sélection → inchangée.
 */
export function selectionAfter(
  kind: StructureKind,
  mode: StructureMode,
  index: number,
  count: number,
  selection: CellAddress,
): CellAddress {
  if (!selection) return null;
  const current = kind === "row" ? selection.row : selection.col;
  const start = index;
  const end = index + count - 1;

  let next = current;
  if (mode === "insert") {
    if (current >= start) next = current + count;
  } else if (current > end) {
    next = current - count;
  } else if (current >= start) {
    // La cellule visée disparaît : on se replace au plus près.
    if (start > 0) next = start - 1;
    else next = Math.min(end + 1, STRUCTURE_MAX[kind] - 1);
  }

  return kind === "row" ? { row: next, col: selection.col } : { row: selection.row, col: next };
}

/**
 * Libellé français d'une opération, utilisé par les messages d'erreur et les
 * annonces de succès (« 1 ligne insérée » / « 2 colonnes supprimées »).
 */
export function structureMessage(kind: StructureKind, mode: StructureMode, count: number): string {
  const label = STRUCTURE_LABEL[kind];
  const plural = count > 1 ? "s" : "";
  return mode === "insert"
    ? `${count} ${label}${plural} insérée${plural}.`
    : `${count} ${label}${plural} supprimée${plural}.`;
}
