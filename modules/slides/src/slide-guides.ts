/**
 * Guides aimantés : pendant un glisser, la sélection se cale sur les bords et
 * les centres — de la diapositive et des autres éléments — comme dans un vrai
 * outil de présentation. Les lignes de repère atteintes sont renvoyées pour
 * être tracées sur le canevas.
 *
 * Logique pure (aucune dépendance), testée directement.
 */

export type SnapBox = { x: number; y: number; w: number; h: number };

/** Une ligne de repère, en pourcentage de la diapositive. */
export type GuideLine = { axis: "x" | "y"; position: number };

export type SnapResult = {
  /** Position ajustée de la boîte qui glisse. */
  x: number;
  y: number;
  /** Repères atteints : bords ou centre de la diapositive, d'autres éléments. */
  guides: GuideLine[];
};

/** Tolérance d'aimantation, en pourcentage de la diapositive. */
export const SNAP_THRESHOLD = 1.1;

/** Cibles de la diapositive elle-même : bords et milieu. */
const CANVAS_TARGETS = [0, 50, 100] as const;

function edgesX(box: SnapBox): number[] {
  return [box.x, box.x + box.w / 2, box.x + box.w];
}

function edgesY(box: SnapBox): number[] {
  return [box.y, box.y + box.h / 2, box.y + box.h];
}

/** Cibles d'un axe : bords/milieu de la diapositive + bords/milieux des voisins. */
function axisTargets(others: readonly SnapBox[], axis: "x" | "y"): number[] {
  const targets: number[] = [...CANVAS_TARGETS];
  for (const box of others) {
    targets.push(...(axis === "x" ? edgesX(box) : edgesY(box)));
  }
  return targets;
}

/**
 * Meilleur ajustement d'un axe : parmi les bords de la boîte, trouve celui qui
 * est le plus proche d'une cible, dans la tolérance. Renvoie le décalage et la
 * position de la cible atteinte.
 */
function bestSnap(
  positions: readonly number[],
  targets: readonly number[],
  threshold: number,
): { delta: number; hit: number | null } {
  let delta = 0;
  let hit: number | null = null;
  let best = threshold;
  for (const position of positions) {
    for (const target of targets) {
      const gap = Math.abs(target - position);
      if (gap < best) {
        best = gap;
        delta = target - position;
        hit = target;
      }
    }
  }
  return { delta, hit };
}

/**
 * Ajuste la boîte glissée sur les repères les plus proches et renvoie les
 * lignes à tracer. Les voisins sont les éléments qui ne glissent pas : deux
 * boîtes ne peuvent donc jamais s'aimanter sur elles-mêmes.
 */
export function snapMove(
  box: SnapBox,
  others: readonly SnapBox[],
  threshold = SNAP_THRESHOLD,
): SnapResult {
  const x = bestSnap(edgesX(box), axisTargets(others, "x"), threshold);
  const y = bestSnap(edgesY(box), axisTargets(others, "y"), threshold);
  const guides: GuideLine[] = [];
  if (x.hit !== null) guides.push({ axis: "x", position: x.hit });
  if (y.hit !== null) guides.push({ axis: "y", position: y.hit });
  return { x: box.x + x.delta, y: box.y + y.delta, guides };
}

/** Boîte englobante d'un ensemble de boîtes (sélection multiple au glisser). */
export function unionBox(boxes: readonly SnapBox[]): SnapBox | null {
  if (boxes.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
