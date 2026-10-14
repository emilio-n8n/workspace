import { describe, expect, it } from "vitest";
import { contrastLevel, contrastRatio, oklchToRgb, relativeLuminance } from "../src/color.ts";
import {
  accentById,
  accentContrastInTheme,
  accentForeground,
  accentLabel,
  DEFAULT_FORM_ACCENT_ID,
  FORM_ACCENT_IDS,
  FORM_ACCENTS,
  isAccessibleContrast,
  MIN_TEXT_CONTRAST,
  normalizeAccentId,
  TEXT_BACKGROUND_TOKEN,
  TEXT_FOREGROUND_TOKEN,
} from "../src/theme.ts";

// ---------------------------------------------------------------------------
// Contraste WCAG (calcul pur)
// ---------------------------------------------------------------------------

describe("forms — contraste", () => {
  it("classe les ratios selon WCAG 2.1", () => {
    expect(contrastLevel(21)).toBe("AAA");
    expect(contrastLevel(7)).toBe("AAA");
    expect(contrastLevel(6.99)).toBe("AA");
    expect(contrastLevel(4.5)).toBe("AA");
    expect(contrastLevel(4.49)).toBe("AA-grands-textes");
    expect(contrastLevel(3)).toBe("AA-grands-textes");
    expect(contrastLevel(2.99)).toBe("insuffisant");
  });

  it("donne 21:1 entre blanc et noir", () => {
    expect(contrastRatio("oklch(1 0 0)", "oklch(0 0 0)")).toBeCloseTo(21, 5);
    expect(contrastRatio("oklch(0 0 0)", "oklch(1 0 0)")).toBeCloseTo(21, 5);
  });

  it("donne 1:1 pour une couleur sur elle-même, sans écart de luminance", () => {
    expect(contrastRatio("oklch(0.5 0.1 200)", "oklch(0.5 0.1 200)")).toBeCloseTo(1, 5);
    expect(relativeLuminance(oklchToRgb("oklch(1 0 0)"))).toBeCloseTo(1, 5);
    expect(relativeLuminance(oklchToRgb("oklch(0 0 0)"))).toBeCloseTo(0, 5);
  });

  it("refuse une couleur illisible", () => {
    expect(() => oklchToRgb("#ffffff")).toThrow(/OKLCH invalide/);
    expect(() => contrastRatio("n'importe quoi", "oklch(1 0 0)")).toThrow();
  });

  it("exige le seuil AA pour le texte courant", () => {
    expect(MIN_TEXT_CONTRAST).toBe(4.5);
    expect(isAccessibleContrast(4.5)).toBe(true);
    expect(isAccessibleContrast(4.49)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Accents sur les tokens
// ---------------------------------------------------------------------------

describe("forms — accents", () => {
  it("désigne chaque accent par un token, jamais par une couleur en dur", () => {
    expect(FORM_ACCENTS.map((accent) => accent.id)).toEqual([...FORM_ACCENT_IDS]);
    for (const accent of FORM_ACCENTS) {
      expect(accent.token.startsWith("var(--color-app-")).toBe(true);
      expect(accent.label.length).toBeGreaterThan(0);
    }
  });

  it("retombe sur l'accent par défaut pour un identifiant inconnu", () => {
    expect(accentById("inconnu").id).toBe(DEFAULT_FORM_ACCENT_ID);
    expect(accentById(undefined).id).toBe(DEFAULT_FORM_ACCENT_ID);
    expect(normalizeAccentId("drive")).toBe("drive");
    expect(normalizeAccentId(null)).toBe(DEFAULT_FORM_ACCENT_ID);
    expect(accentLabel("nope")).toBe(accentById(DEFAULT_FORM_ACCENT_ID).label);
  });

  it("choisit le token le plus lisible sur l'accent", () => {
    // Accent très clair : l'encre sombre l'emporte.
    const clair = accentForeground("oklch(0.95 0 0)", {
      background: "oklch(0.98 0 0)",
      foreground: "oklch(0.1 0 0)",
    });
    expect(clair.token).toBe(TEXT_FOREGROUND_TOKEN);

    // Accent très sombre : le fond clair l'emporte.
    const sombre = accentForeground("oklch(0.15 0 0)", {
      background: "oklch(0.98 0 0)",
      foreground: "oklch(0.1 0 0)",
    });
    expect(sombre.token).toBe(TEXT_BACKGROUND_TOKEN);
    expect(sombre.ratio).toBeGreaterThan(clair.ratio - 1);
  });

  it("ignore un token illisible plutôt que d'inventer une couleur", () => {
    const resultat = accentForeground("oklch(0.15 0 0)", {
      background: "pas une couleur",
      foreground: "oklch(0.98 0 0)",
    });
    expect(resultat.token).toBe(TEXT_FOREGROUND_TOKEN);

    const aucun = accentForeground("couleur impossible", {
      background: "pas une couleur",
      foreground: "non plus",
    });
    expect(aucun.token).toBe(TEXT_BACKGROUND_TOKEN);
    expect(aucun.ratio).toBe(1);
    expect(aucun.level).toBe("insuffisant");
  });

  it("mesure chaque accent dans le thème clair et sombre", () => {
    const clair = { background: "oklch(0.975 0.006 85)", foreground: "oklch(0.22 0.015 70)" };
    const sombre = { background: "oklch(0.18 0.012 75)", foreground: "oklch(0.93 0.008 80)" };
    for (const accent of FORM_ACCENTS) {
      for (const [dark, tokens] of [
        [false, clair],
        [true, sombre],
      ] as const) {
        const mesuré = accentContrastInTheme(accent, { ...tokens, dark });
        expect(mesuré.ratio).toBeGreaterThanOrEqual(1);
        expect(mesuré.ratio).toBeLessThanOrEqual(21);
        expect(mesuré.level).toBe(contrastLevel(mesuré.ratio));
      }
    }
  });
});
