/**
 * Poignée de rotation (PowerPoint) : l'angle suit le pointeur autour du centre
 * de l'élément ; Maj aimante par pas de 15°. Logique pure.
 */

/** Pas de l'aimantation avec Maj. */
export const ROTATION_SNAP_DEGREES = 15;

/**
 * Angle (degrés entiers, [0, 360)) d'un élément dont la poignée, placée
 * au-dessus du centre à 0°, est tirée jusqu'au point `pointer`.
 */
export function rotationFromPointer(
  center: { x: number; y: number },
  pointer: { x: number; y: number },
  snap: boolean,
): number {
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  if (dx === 0 && dy === 0) return 0;
  // atan2 mesure depuis l'axe des x ; la poignée est en haut (−90°).
  let degrees = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  if (snap) degrees = Math.round(degrees / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES;
  const normalized = Math.round(((degrees % 360) + 360) % 360);
  return normalized === 360 ? 0 : normalized;
}

/** Libellé d'aide affiché pendant le geste (« 45° »). */
export function rotationLabel(degrees: number): string {
  return `${degrees}°`;
}

/**
 * Rotation pendant un glisser de poignée, relative à la prise : l'élément
 * tourne de l'angle parcouru par le pointeur autour du centre (la poignée
 * peut être au-dessus ou en dessous sans saut de 180°). Maj aimante le
 * résultat sur un multiple de 15°.
 */
export function rotateFromDrag(
  initialRotation: number,
  center: { x: number; y: number },
  start: { x: number; y: number },
  current: { x: number; y: number },
  snap: boolean,
): number {
  const delta =
    rotationFromPointer(center, current, false) - rotationFromPointer(center, start, false);
  let degrees = initialRotation + delta;
  if (snap) degrees = Math.round(degrees / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES;
  const normalized = Math.round(((degrees % 360) + 360) % 360);
  return normalized === 360 ? 0 : normalized;
}
