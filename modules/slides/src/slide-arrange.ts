/**
 * Disposition d'objets : aligner une sélection et répartir les espacements,
 * comme la palette « Aligner » d'un vrai outil de présentation.
 *
 * Un seul élément s'aligne sur la **diapositive** ; plusieurs s'alignent sur
 * leur boîte englobante (le comportement attendu : aligner deux objets les met
 * sur la même ligne, pas sur les bords de la diapositive).
 *
 * Logique pure (aucune dépendance), testée directement.
 */

import type { SnapBox } from "./slide-guides.ts";

export type ArrangeTarget = { key: string; box: SnapBox };

export type ArrangeMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

export type ArrangePatch = { key: string; x: number; y: number };

const CANVAS: SnapBox = { x: 0, y: 0, w: 100, h: 100 };

function referenceBox(targets: readonly ArrangeTarget[]): SnapBox {
  if (targets.length <= 1) return CANVAS;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const { box } of targets) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Ramène chaque boîte au plus près du bord visé sans jamais changer sa taille. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Patchs d'alignement : seules les coordonnées concernées changent, bornées à
 * la diapositive (un élément aligné à droite ne peut pas dépasser).
 */
export function alignPatches(targets: readonly ArrangeTarget[], mode: ArrangeMode): ArrangePatch[] {
  if (targets.length === 0) return [];
  const reference = referenceBox(targets);
  return targets.map(({ key, box }) => {
    let { x, y } = box;
    if (mode === "left") x = reference.x;
    else if (mode === "hcenter") x = reference.x + (reference.w - box.w) / 2;
    else if (mode === "right") x = reference.x + reference.w - box.w;
    else if (mode === "top") y = reference.y;
    else if (mode === "vcenter") y = reference.y + (reference.h - box.h) / 2;
    else if (mode === "bottom") y = reference.y + reference.h - box.h;
    return {
      key,
      x: round1(clamp(x, 0, 100 - box.w)),
      y: round1(clamp(y, 0, 100 - box.h)),
    };
  });
}

/**
 * Répartition : les deux éléments extrêmes ne bougent pas, les centres des
 * éléments intermédiaires sont espacés régulièrement. Il faut au moins trois
 * éléments — sinon l'espacement est déjà régulier par définition.
 */
export function distributePatches(
  targets: readonly ArrangeTarget[],
  axis: "x" | "y",
): ArrangePatch[] {
  if (targets.length < 3) return [];
  const sorted = [...targets].sort((a, b) =>
    axis === "x" ? a.box.x - b.box.x : a.box.y - b.box.y,
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return [];
  const centerOf = (box: SnapBox): number => (axis === "x" ? box.x + box.w / 2 : box.y + box.h / 2);
  const start = centerOf(first.box);
  const end = centerOf(last.box);
  const step = (end - start) / (sorted.length - 1);

  const patches: ArrangePatch[] = [];
  sorted.forEach((target, index) => {
    if (index === 0 || index === sorted.length - 1) return;
    const center = start + step * index;
    if (axis === "x") {
      patches.push({
        key: target.key,
        x: round1(clamp(center - target.box.w / 2, 0, 100 - target.box.w)),
        y: target.box.y,
      });
    } else {
      patches.push({
        key: target.key,
        x: target.box.x,
        y: round1(clamp(center - target.box.h / 2, 0, 100 - target.box.h)),
      });
    }
  });
  return patches;
}
