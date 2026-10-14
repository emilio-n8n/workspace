/**
 * Couleur et contraste — calculs purs, sans DOM.
 *
 * Portés de `scripts/contrast-check.mjs` (vérification WCAG des tokens) :
 * conversion OKLCH → sRGB selon CSS Color 4, luminance relative et ratio
 * WCAG 2.1. Le thème d'un formulaire ne choisit jamais une couleur en dur : il
 * désigne un token de la palette, et c'est ce ratio qui décide du texte.
 */

export type Rgb = { r: number; g: number; b: number; alpha: number };

/** Niveaux WCAG 2.1, du plus exigeant au plus faible. */
export type ContrastLevel = "AAA" | "AA" | "AA-grands-textes" | "insuffisant";

/**
 * Niveau WCAG d'un ratio de contraste : AAA (≥ 7), AA (≥ 4,5), AA pour les
 * grands textes et les éléments d'interface (≥ 3), insuffisant en dessous.
 */
export function contrastLevel(ratio: number): ContrastLevel {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-grands-textes";
  return "insuffisant";
}

/** Extrait les canaux d'une couleur `oklch(L C H [/ A])` (L en nombre ou %). */
export function oklchToRgb(value: string): Rgb {
  const match = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)%?)?\s*\)/.exec(
    value,
  );
  if (!match) throw new Error(`OKLCH invalide : ${value}`);
  const lightness = match[1];
  const l = lightness?.endsWith("%")
    ? Number.parseFloat(lightness.slice(0, -1)) / 100
    : Number.parseFloat(lightness ?? "0");
  const c = Number.parseFloat(match[2] ?? "0");
  const h = (Number.parseFloat(match[3] ?? "0") * Math.PI) / 180;
  const alpha = match[4] !== undefined ? Number.parseFloat(match[4]) / 100 : 1;

  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;

  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const blue = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  const encode = (channel: number) => {
    const v = Math.min(1, Math.max(0, channel));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return { r: encode(r), g: encode(g), b: encode(blue), alpha };
}

/** Luminance relative d'une couleur sRGB (0 = noir, 1 = blanc). */
export function relativeLuminance(rgb: Rgb): number {
  const channel = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Compose un texte semi-transparent sur son fond (le texte doit être opaque ensuite). */
export function composite(fg: Rgb, bg: Rgb): Rgb {
  if (fg.alpha >= 1) return fg;
  return {
    r: fg.r * fg.alpha + bg.r * (1 - fg.alpha),
    g: fg.g * fg.alpha + bg.g * (1 - fg.alpha),
    b: fg.b * fg.alpha + bg.b * (1 - fg.alpha),
    alpha: 1,
  };
}

/** Ratio de contraste WCAG 2.1 entre deux couleurs `oklch(...)` (1 à 21). */
export function contrastRatio(foreground: string, background: string): number {
  const bg = oklchToRgb(background);
  const fg = composite(oklchToRgb(foreground), bg);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
