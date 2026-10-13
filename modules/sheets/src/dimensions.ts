/**
 * Dimensions de la grille : largeur des colonnes, hauteur des lignes.
 *
 * Logique pure (aucune dépendance DOM ni base) pour que les règles de
 * redimensionnement soient testables seules — l'interface ne fait que les
 * appliquer. Règle de stockage : une taille égale au défaut n'est jamais
 * persistée, la base ne garde que les écarts.
 */

import { MAX_COLS, MAX_ROWS } from "./csv.ts";

export type DimensionAxis = "col" | "row";

export type DimensionLimits = { min: number; max: number; fallback: number };

/** Bornes par axe, en pixels (borne haute généreuse : un tableur se lit large). */
export const DIMENSION_LIMITS: Record<DimensionAxis, DimensionLimits> = {
  col: { min: 44, max: 640, fallback: 96 },
  row: { min: 20, max: 320, fallback: 24 },
};

/** Nombre maximal d'index par axe (aligné sur la grille logique). */
export const DIMENSION_INDEX_MAX: Record<DimensionAxis, number> = {
  col: MAX_COLS,
  row: MAX_ROWS,
};

/** Pas du redimensionnement au clavier : flèche simple, puis Majuscule. */
export const DIMENSION_KEY_STEP = 4;
export const DIMENSION_KEY_STEP_LARGE = 24;

/** Nombre maximal de tailles écrites par appel (borne les lots d'autosave). */
export const MAX_DIMENSION_SIZES = 500;

/** Libellés français d'un axe (messages d'erreur et noms accessibles). */
export const AXIS_LABEL: Record<DimensionAxis, string> = { col: "colonne", row: "ligne" };

export type DimensionSize = { axis: DimensionAxis; index: number; size: number };

/** Carte des tailles d'un axe : index de ligne/colonne → pixels. */
export type SizeMap = Map<number, number>;

/**
 * Valide une taille et renvoie un message français en cas de refus,
 * `null` si la valeur est acceptable.
 */
export function validateSize(axis: DimensionAxis, index: number, size: number): string | null {
  const limits = DIMENSION_LIMITS[axis];
  // Un axe inconnu (données corrompues) doit être refusé, pas faire planter.
  if (!limits) return `Axe de redimensionnement invalide : ${String(axis)}.`;
  const label = AXIS_LABEL[axis];
  if (!Number.isInteger(index) || index < 0 || index >= DIMENSION_INDEX_MAX[axis]) {
    return `Position de ${label} hors limites (${DIMENSION_INDEX_MAX[axis]} maximum).`;
  }
  if (!Number.isInteger(size) || size < limits.min || size > limits.max) {
    return `Taille de ${label} entre ${limits.min} et ${limits.max} pixels.`;
  }
  return null;
}

/** Ramène une taille dans les bornes de l'axe (les non-nombres retombent au défaut). */
export function clampSize(axis: DimensionAxis, size: number): number {
  const limits = DIMENSION_LIMITS[axis];
  if (!Number.isFinite(size)) return limits.fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.round(size)));
}

/** Taille effective d'un index : la taille choisie, sinon le défaut de l'axe. */
export function sizeOf(sizes: SizeMap, index: number, axis: DimensionAxis): number {
  return sizes.get(index) ?? DIMENSION_LIMITS[axis].fallback;
}

/** Vrai quand la taille diffère du défaut (donc mérite d'être persistée). */
export function isCustomSize(axis: DimensionAxis, size: number): boolean {
  return size !== DIMENSION_LIMITS[axis].fallback;
}

/**
 * Applique un redimensionnement et renvoie une nouvelle carte (immuable) :
 * une taille revenue au défaut retire l'entrée au lieu de la stocker.
 */
export function applyResize(
  sizes: SizeMap,
  axis: DimensionAxis,
  index: number,
  size: number,
): SizeMap {
  const next = new Map(sizes);
  const clamped = clampSize(axis, size);
  if (isCustomSize(axis, clamped)) next.set(index, clamped);
  else next.delete(index);
  return next;
}

/** Décale une taille d'un delta borné (utilisé par le redimensionnement au clavier). */
export function stepSize(
  sizes: SizeMap,
  axis: DimensionAxis,
  index: number,
  delta: number,
): SizeMap {
  return applyResize(sizes, axis, index, sizeOf(sizes, index, axis) + delta);
}

/**
 * Relit des tailles persistées en cartes par onglet puis par axe, en ignorant
 * les entrées invalides : une ligne corrompue ne doit jamais casser l'affichage.
 */
export function parseSizes(
  records: (DimensionSize & { tabId: string })[],
): Map<string, Record<DimensionAxis, SizeMap>> {
  const parsed = new Map<string, Record<DimensionAxis, SizeMap>>();
  for (const record of records) {
    if (!record || typeof record !== "object" || typeof record.tabId !== "string") continue;
    const sizes = parsed.get(record.tabId) ?? { col: new Map(), row: new Map() };
    parsed.set(record.tabId, sizes);
    if (validateSize(record.axis, record.index, record.size) !== null) continue;
    if (!isCustomSize(record.axis, record.size)) continue;
    sizes[record.axis].set(record.index, record.size);
  }
  return parsed;
}

/** Clé stable d'une taille (index d'une carte d'attente d'autosave). */
export function sizeKey(axis: DimensionAxis, index: number): string {
  return `${axis}:${index}`;
}
