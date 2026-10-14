/**
 * Aperçu du site (TASK-004) : gabarits réalistes de la fenêtre d'édition.
 *
 * Module pur : l'interface choisit un gabarit (ordinateur, tablette, mobile),
 * le canevas d'aperçu applique
 * sa largeur. La largeur est **explicite** (et non un simple `max-width`) afin
 * que le contenu ne soit jamais rogné : dans un éditeur plus étroit que le
 * gabarit, le cadre défile horizontalement au lieu de couper la page.
 */

export type PreviewViewportId = "desktop" | "tablet" | "mobile";

export type PreviewViewport = {
  id: PreviewViewportId;
  label: string;
  /** Largeur réaliste de l'écran, en pixels CSS. */
  width: number;
  /** Hauteur de référence : sert à juger du pliage au-dessus de la ligne de flottaison. */
  height: number;
};

export const PREVIEW_VIEWPORTS: readonly PreviewViewport[] = [
  { id: "desktop", label: "Ordinateur", width: 1280, height: 800 },
  { id: "tablet", label: "Tablette", width: 834, height: 1112 },
  { id: "mobile", label: "Mobile", width: 390, height: 844 },
];

/** Valeur par défaut du sélecteur de gabarit. */
export const DEFAULT_PREVIEW_VIEWPORT: PreviewViewportId = "desktop";

/** Repli utilisé quand un identifiant de gabarit est inconnu. */
const FALLBACK_VIEWPORT: PreviewViewport = PREVIEW_VIEWPORTS[0] ?? {
  id: DEFAULT_PREVIEW_VIEWPORT,
  label: "Ordinateur",
  width: 1280,
  height: 800,
};

/** Gabarit demandé ; un identifiant inconnu retombe sur le gabarit par défaut. */
export function previewViewport(id: string): PreviewViewport {
  return PREVIEW_VIEWPORTS.find((viewport) => viewport.id === id) ?? FALLBACK_VIEWPORT;
}

/** Largeur appliquée au cadre (`style.width`), en pixels CSS. */
export function previewFrameWidth(id: string): string {
  return `${previewViewport(id).width}px`;
}

/** Hauteur minimale du cadre : la page garde sa hauteur d'écran de référence. */
export function previewFrameHeight(id: string): string {
  return `${previewViewport(id).height}px`;
}

/** Intitulé du gabarit, pour les libellés d'accessibilité. */
export function previewViewportLabel(id: string): string {
  return previewViewport(id).label;
}
