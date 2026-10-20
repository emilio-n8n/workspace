/**
 * Mise en page du document (Fichier › Mise en page) : format du papier,
 * orientation et marges, comme dans Word.
 *
 * Stockée dans les attributs du nœud racine du document (`doc.attrs.pageSetup`)
 * — donc dans le JSON déjà persisté : aucune migration, et un document ancien
 * (sans attribut) s'ouvre avec la mise en page par défaut (A4 portrait,
 * marges de 2,5 cm).
 *
 * Logique pure : l'éditeur, l'impression et les tests partagent ces fonctions.
 */

export type PaperSizeId = "a4" | "letter" | "legal" | "a5";
export type PageOrientation = "portrait" | "landscape";

export type PageMargins = {
  /** Marges en millimètres. */
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type PageSetup = {
  size: PaperSizeId;
  orientation: PageOrientation;
  margins: PageMargins;
};

export type PaperSize = { id: PaperSizeId; label: string; widthMm: number; heightMm: number };

/** Formats proposés, dimensions portrait en millimètres. */
export const PAPER_SIZES: readonly PaperSize[] = [
  { id: "a4", label: "A4 (21 × 29,7 cm)", widthMm: 210, heightMm: 297 },
  { id: "letter", label: "Lettre US (21,6 × 27,9 cm)", widthMm: 215.9, heightMm: 279.4 },
  { id: "legal", label: "Légal US (21,6 × 35,6 cm)", widthMm: 215.9, heightMm: 355.6 },
  { id: "a5", label: "A5 (14,8 × 21 cm)", widthMm: 148, heightMm: 210 },
];

export type MarginPresetId = "normal" | "narrow" | "moderate" | "wide";

/** Préréglages de marges (millimètres), comme le menu « Marges » de Word. */
export const MARGIN_PRESETS: readonly {
  id: MarginPresetId;
  label: string;
  margins: PageMargins;
}[] = [
  {
    id: "normal",
    label: "Normales (2,5 cm)",
    margins: { top: 25, right: 25, bottom: 25, left: 25 },
  },
  {
    id: "narrow",
    label: "Étroites (1,27 cm)",
    margins: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
  },
  {
    id: "moderate",
    label: "Moyennes (1,9 cm)",
    margins: { top: 25.4, right: 19.1, bottom: 25.4, left: 19.1 },
  },
  {
    id: "wide",
    label: "Larges (5 cm)",
    margins: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 },
  },
];

export const DEFAULT_PAGE_SETUP: PageSetup = {
  size: "a4",
  orientation: "portrait",
  margins: { top: 25, right: 25, bottom: 25, left: 25 },
};

/** Marge minimale et maximale acceptées (mm) : la zone de texte reste utilisable. */
export const MARGIN_LIMITS = { min: 0, max: 80 } as const;

/** Pixels CSS par millimètre (96 ppp). */
export const PX_PER_MM = 96 / 25.4;

function clampMargin(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(MARGIN_LIMITS.max, Math.max(MARGIN_LIMITS.min, number)) * 10) / 10;
}

/**
 * Relit une mise en page venue du JSON (attribut absent, ancien format,
 * valeur trafiquée) : toujours une mise en page complète et bornée.
 */
export function normalizePageSetup(raw: unknown): PageSetup {
  if (!raw || typeof raw !== "object") return DEFAULT_PAGE_SETUP;
  const record = raw as Record<string, unknown>;
  const size = PAPER_SIZES.some((paper) => paper.id === record.size)
    ? (record.size as PaperSizeId)
    : DEFAULT_PAGE_SETUP.size;
  const orientation: PageOrientation =
    record.orientation === "landscape" ? "landscape" : "portrait";
  const margins = (record.margins ?? {}) as Record<string, unknown>;
  const fallback = DEFAULT_PAGE_SETUP.margins;
  return {
    size,
    orientation,
    margins: {
      top: clampMargin(margins.top, fallback.top),
      right: clampMargin(margins.right, fallback.right),
      bottom: clampMargin(margins.bottom, fallback.bottom),
      left: clampMargin(margins.left, fallback.left),
    },
  };
}

/** Dimensions de la feuille (mm) selon le format et l'orientation. */
export function pageSizeMm(setup: PageSetup): { width: number; height: number } {
  const paper = PAPER_SIZES.find((candidate) => candidate.id === setup.size) ?? PAPER_SIZES[0];
  const width = paper?.widthMm ?? 210;
  const height = paper?.heightMm ?? 297;
  return setup.orientation === "landscape" ? { width: height, height: width } : { width, height };
}

/**
 * Géométrie de la feuille à l'écran, en pixels CSS : largeur et hauteur de la
 * page, marges, et largeur utile (zone de texte). La largeur utile ne descend
 * jamais sous 2 cm, même avec des marges extrêmes.
 */
export function pageGeometry(setup: PageSetup): {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  contentWidth: number;
} {
  const size = pageSizeMm(setup);
  const minContent = 20;
  let { left, right } = setup.margins;
  const overflow = left + right + minContent - size.width;
  if (overflow > 0) {
    left = Math.max(0, left - overflow / 2);
    right = Math.max(0, right - overflow / 2);
  }
  const px = (mm: number) => Math.round(mm * PX_PER_MM);
  return {
    width: px(size.width),
    height: px(size.height),
    padding: {
      top: px(setup.margins.top),
      right: px(right),
      bottom: px(setup.margins.bottom),
      left: px(left),
    },
    contentWidth: px(size.width - left - right),
  };
}

/** Préréglage de marges correspondant exactement, sinon `null` (personnalisées). */
export function marginPresetOf(margins: PageMargins): MarginPresetId | null {
  const match = MARGIN_PRESETS.find(
    (preset) =>
      preset.margins.top === margins.top &&
      preset.margins.right === margins.right &&
      preset.margins.bottom === margins.bottom &&
      preset.margins.left === margins.left,
  );
  return match?.id ?? null;
}

/** Règle `@page` d'impression correspondant à la mise en page. */
export function printPageRule(setup: PageSetup): string {
  const size = pageSizeMm(setup);
  const { top, right, bottom, left } = setup.margins;
  return `@page { size: ${size.width}mm ${size.height}mm; margin: ${top}mm ${right}mm ${bottom}mm ${left}mm; }`;
}

/**
 * Graduations de la règle horizontale : un repère tous les 5 mm, numéroté en
 * centimètres depuis la marge gauche (origine de la règle, comme dans Word).
 */
export function rulerTicks(
  setup: PageSetup,
): { mm: number; major: boolean; label: string | null }[] {
  const { width } = pageSizeMm(setup);
  const origin = Math.min(setup.margins.left, width);
  const ticks: { mm: number; major: boolean; label: string | null }[] = [];
  const first = Math.ceil(-origin / 5);
  const last = Math.floor((width - origin) / 5);
  for (let step = first; step <= last; step += 1) {
    const major = step % 2 === 0;
    const centimetre = Math.abs(step / 2);
    ticks.push({
      mm: Math.round((origin + step * 5) * 10) / 10,
      major,
      label: major && step !== 0 ? String(centimetre) : null,
    });
  }
  return ticks;
}
