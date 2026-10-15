import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIDE_THEME,
  normalizeTheme,
  SLIDE_THEME_IDS,
  SLIDE_THEMES,
  themeCanvasClass,
  themeDecor,
  themeHint,
  themeLabel,
  themeLineClass,
  themeShapeClass,
  themeSwatchClass,
} from "../src/slide-theme.ts";

describe("slides — designs", () => {
  it("propose cinq designs, « papier » par défaut", () => {
    expect(SLIDE_THEME_IDS).toEqual(["papier", "encre", "accent", "bande", "fiche"]);
    expect(DEFAULT_SLIDE_THEME).toBe("papier");
  });

  it("relit un design persisté et rejette les valeurs inconnues", () => {
    expect(normalizeTheme("encre")).toBe("encre");
    expect(normalizeTheme("accent")).toBe("accent");
    expect(normalizeTheme("bande")).toBe("bande");
    expect(normalizeTheme("fiche")).toBe("fiche");
    expect(normalizeTheme("violet")).toBe(DEFAULT_SLIDE_THEME);
    expect(normalizeTheme(null)).toBe(DEFAULT_SLIDE_THEME);
    expect(normalizeTheme(7)).toBe(DEFAULT_SLIDE_THEME);
  });

  it("n'emploie que des jetons sémantiques, ornements compris", () => {
    const allowed =
      /^(?:bg|text|border|outline)-(?:card|foreground|background|muted|accent|accent-foreground|primary|border|transparent|ring)(?:\/\d+)?$/;
    for (const id of SLIDE_THEME_IDS) {
      const theme = SLIDE_THEMES[id];
      const classes = `${theme.canvas} ${theme.shape} ${theme.line} ${theme.ring} ${
        theme.decor?.className ?? ""
      }`
        .split(/\s+/)
        .filter(Boolean);
      for (const value of classes) {
        expect(value).toMatch(allowed);
      }
    }
  });

  it("décrit chaque design en français", () => {
    expect(themeLabel("papier")).toBe("Papier");
    expect(themeLabel("encre")).toBe("Encre");
    expect(themeLabel("accent")).toBe("Accent");
    expect(themeLabel("bande")).toBe("Bandeau");
    expect(themeLabel("fiche")).toBe("Fiche");
    expect(themeHint("encre")).toContain("sombre");
    for (const id of SLIDE_THEME_IDS) {
      expect(themeHint(id).length).toBeGreaterThan(0);
    }
    expect(themeLabel("inconnu" as "encre")).toBe("Papier");
  });

  it("applique un design au canevas, aux formes et à la pastille", () => {
    expect(themeCanvasClass("encre")).toContain("bg-foreground");
    expect(themeShapeClass("encre")).toContain("bg-background/10");
    expect(themeLineClass("encre")).toBe("bg-background/40");
    expect(themeCanvasClass("accent")).toContain("text-accent-foreground");
    expect(themeSwatchClass("papier")).toBe("bg-card border-border");
    expect(themeSwatchClass("bande")).toBe("bg-primary border-border");
    expect(themeCanvasClass("inconnu" as "encre")).toBe(themeCanvasClass("papier"));
  });

  it("ne dote d'un ornement que les designs maquettés", () => {
    expect(themeDecor("papier")).toBeNull();
    expect(themeDecor("encre")).toBeNull();
    expect(themeDecor("bande")).toEqual({ className: "bg-primary", position: "top" });
    expect(themeDecor("fiche")).toEqual({ className: "bg-accent", position: "left" });
  });
});
