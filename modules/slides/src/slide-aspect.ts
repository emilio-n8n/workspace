/**
 * Formats de diapositive (16:9, 4:3) et conversion de la scène.
 *
 * Les positions des éléments sont des pourcentages de la diapositive. Le
 * canevas est rendu à **largeur constante** (`w-full` + `aspect-[w/h]`), donc
 * changer de format ne change que sa hauteur : la conversion ne remet à
 * l'échelle que l'axe vertical, par le rapport des deux formats. Les éléments
 * gardent ainsi leur taille réelle et rien n'est rogné horizontalement.
 *
 * Si la scène ne tient plus dans le nouveau cadre (passage dans un format plus
 * court), toute la scène est réduite d'un facteur unique jusqu'à rentrer —
 * jamais d'élément poussé en dehors de la diapositive.
 *
 * Logique pure (aucune dépendance) : testable sans navigateur ni base.
 */

/** Pourcentages de la diapositive (0-100). */
export type SceneElement = { x: number; y: number; w: number; h: number };

export type SlideAspectId = "16:9" | "4:3";

export type SlideAspect = {
  id: SlideAspectId;
  /** Libellé français affiché dans le sélecteur. */
  label: string;
  /**
   * Cadre du format, à **hauteur commune** (9) : c'est ce qui rend les deux
   * formats comparables et donne leur rapport largeur/hauteur.
   */
  width: number;
  height: number;
};

export const SLIDE_ASPECTS: Record<SlideAspectId, SlideAspect> = {
  "16:9": { id: "16:9", label: "16:9 — écran large", width: 16, height: 9 },
  "4:3": { id: "4:3", label: "4:3 — écran classique", width: 12, height: 9 },
};

/** Format attribué aux nouvelles présentations et aux valeurs illisibles. */
export const DEFAULT_SLIDE_ASPECT: SlideAspectId = "16:9";

/** Identifiants de formats, dans l'ordre d'affichage du sélecteur. */
export const SLIDE_ASPECT_IDS = Object.keys(SLIDE_ASPECTS) as SlideAspectId[];

/** Rapport largeur/hauteur d'un format. */
export function aspectRatio(aspect: SlideAspectId): number {
  const frame = SLIDE_ASPECTS[normalizeAspect(aspect)];
  return frame.width / frame.height;
}

/** Rapport de chaque format, pour la classe CSS `aspect-[w/h]`. */
export function aspectRatioCss(aspect: SlideAspectId): string {
  const frame = SLIDE_ASPECTS[normalizeAspect(aspect)];
  return `${frame.width}/${frame.height}`;
}

/** Relit un format persisté : toute valeur inconnue retombe au défaut. */
export function normalizeAspect(value: unknown): SlideAspectId {
  if (typeof value === "string" && value in SLIDE_ASPECTS) {
    return value as SlideAspectId;
  }
  return DEFAULT_SLIDE_ASPECT;
}

/**
 * Facteur appliqué à l'axe vertical : rapport du nouveau format sur l'ancien.
 * La largeur rendue ne changeant pas, l'axe horizontal n'a pas besoin d'être
 * converti — seules la hauteur du cadre, donc `y` et `h`, suivent.
 */
export function aspectFactor(from: SlideAspectId, to: SlideAspectId): number {
  if (from === to) return 1;
  return aspectRatio(to) / aspectRatio(from);
}

/** Borne un pourcentage dans la diapositive, comme le service. */
function clampPercent(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export type SceneConversion<T extends SceneElement> = {
  elements: T[];
  /** Facteur vertical appliqué par le changement de format (1 si identique). */
  factor: number;
  /**
   * Facteur de réduction supplémentaire (≤ 1) appliqué à toute la scène quand
   * elle débordait du nouveau cadre. 1 quand rien n'a débordé.
   */
  fit: number;
  /** Vrai quand au moins un élément a bougé. */
  changed: boolean;
};

/**
 * Plus grand facteur de réduction (≤ 1) qui fait rentrer toute la scène dans
 * la diapositive. On ne réduit jamais : une scène qui tient déjà garde son
 * échelle.
 */
function fitFactor(elements: SceneElement[]): number {
  let scale = 1;
  for (const element of elements) {
    const reach = Math.max(element.y + element.h, element.x + element.w);
    if (reach > 100) scale = Math.min(scale, 100 / reach);
  }
  // Garde-fou numérique : une scène dégénérée ne doit pas devenir invisible.
  return clampPercent(scale, 0.1, 1);
}

/**
 * Convertit une scène d'un format vers l'autre.
 *
 * 1. `y` et `h` sont mis à l'échelle par le rapport des formats (la largeur
 *    rendue du canevas ne change pas) ;
 * 2. si la scène débordait, elle est réduite en bloc jusqu'à rentrer ;
 * 3. chaque élément est enfin ramené dans la diapositive
 *    (x ∈ [0, 100-w], y ∈ [0, 100-h]), la règle de containment du service.
 */
export function convertScene<T extends SceneElement>(
  elements: T[],
  from: SlideAspectId,
  to: SlideAspectId,
): SceneConversion<T> {
  const factor = aspectFactor(from, to);
  if (factor === 1) return { elements, factor, fit: 1, changed: false };

  const scaled = elements.map((element) => ({
    ...element,
    y: round1(clampPercent(element.y * factor, 0, 100)),
    h: clampPercent(round1(element.h * factor), 1, 100),
  }));

  const fit = fitFactor(scaled);
  const total = fit === 1 ? factor : factor * fit;

  let changed = false;
  const converted = scaled.map((element, index) => {
    // Même longueur que `elements` : le repli ne sert qu'à satisfaire le typage.
    const origin = elements[index] ?? element;
    const w = clampPercent(round1(element.w * fit), 1, 100);
    const h = clampPercent(round1(element.h * fit), 1, 100);
    const next = {
      ...element,
      x: clampPercent(round1(element.x * fit), 0, 100 - w),
      y: clampPercent(round1(element.y * fit), 0, 100 - h),
      w,
      h,
    };
    // Comparaison avec l'état d'origine, pas avec l'étape intermédiaire.
    const moved =
      next.x !== origin.x || next.y !== origin.y || next.w !== origin.w || next.h !== origin.h;
    if (moved) changed = true;
    return moved ? next : origin;
  });

  return { elements: converted, factor: total, fit, changed };
}

/** Libellé d'un format (« 16:9 — écran large »). */
export function aspectLabel(aspect: SlideAspectId): string {
  return SLIDE_ASPECTS[normalizeAspect(aspect)].label;
}

/** Message affiché après une conversion de scène. */
export function conversionSummary(from: SlideAspectId, to: SlideAspectId, count: number): string {
  const factor = aspectFactor(from, to);
  const percent = Math.round(factor * 100);
  const plural = count > 1 ? "s" : "";
  return `Scène convertie de ${from} vers ${to} : ${count} élément${plural} mis à l'échelle (${percent} % de la hauteur).`;
}
