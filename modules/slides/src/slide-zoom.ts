/**
 * Zoom d'affichage du canevas : niveaux proposés, bornes, ajustement à la
 * fenêtre. Logique pure (aucune dépendance) : l'éditeur ne fait qu'appliquer
 * la valeur, les tests la vérifient.
 */

/** Largeur de référence du canevas à 100 % (identique à `--slide-design-width`). */
export const SLIDE_BASE_WIDTH = 960;

export const ZOOM_MIN = 30;
export const ZOOM_MAX = 200;

/** Niveaux proposés par les boutons − / + (et le sélecteur). */
export const SLIDE_ZOOM_PRESETS = [50, 75, 100, 125, 150] as const;
export type SlideZoomPreset = (typeof SLIDE_ZOOM_PRESETS)[number];

/** Borne un zoom : entier entre 30 et 200, 100 pour une valeur illisible. */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)));
}

/**
 * Zoom « ajuster à la fenêtre » : le canevas tient dans la largeur disponible,
 * marge comprise, borné pour ne jamais devenir illisible ni démesuré.
 */
export function fitZoomPercent(workspaceWidth: number, margin = 48): number {
  if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) return 100;
  return clampZoom(((workspaceWidth - margin) / SLIDE_BASE_WIDTH) * 100);
}

/** Niveau suivant ou précédent : les presets d'abord, puis des pas de 10 %. */
export function nextZoom(current: number, direction: -1 | 1): number {
  const value = clampZoom(current);
  if (direction === 1) {
    const next = SLIDE_ZOOM_PRESETS.find((preset) => preset > value);
    return next ?? clampZoom(value + 10);
  }
  const previous = [...SLIDE_ZOOM_PRESETS].reverse().find((preset) => preset < value);
  return previous ?? clampZoom(value - 10);
}
