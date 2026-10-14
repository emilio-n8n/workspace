import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIDE_THEME,
  normalizeTheme,
  SLIDE_THEME_IDS,
  SLIDE_THEMES,
  themeCanvasClass,
  themeHint,
  themeLabel,
  themeLineClass,
  themeShapeClass,
  themeSwatchClass,
} from "../src/slide-theme.ts";

describe("slides — thèmes", () => {
  it("propose trois thèmes, « papier » par défaut", () => {
    expect(SLIDE_THEME_IDS).toEqual(["papier", "encre", "accent"]);
    expect(DEFAULT_SLIDE_THEME).toBe("papier");
  });

  it("relit un thème persisté et rejette les valeurs inconnues", () => {
    expect(normalizeTheme("encre")).toBe("encre");
    expect(normalizeTheme("accent")).toBe("accent");
    expect(normalizeTheme("violet")).toBe(DEFAULT_SLIDE_THEME);
    expect(normalizeTheme(null)).toBe(DEFAULT_SLIDE_THEME);
    expect(normalizeTheme(7)).toBe(DEFAULT_SLIDE_THEME);
  });

  it("n'emploie que des classes de jetons sémantiques", () => {
    for (const id of SLIDE_THEME_IDS) {
      const theme = SLIDE_THEMES[id];
      const classes = `${theme.canvas} ${theme.shape} ${theme.line} ${theme.ring}`
        .split(/\s+/)
        .filter(Boolean);
      for (const value of classes) {
        // Préfixe d'utilité, jeton sémantique, opacité optionnelle.
        expect(value).toMatch(
          /^(?:bg|text|border|outline)-(?:card|foreground|background|muted|accent|accent-foreground|border|transparent|ring)(?:\/\d+)?$/,
        );
      }
    }
  });

  it("décrit chaque thème en français", () => {
    expect(themeLabel("papier")).toBe("Papier");
    expect(themeLabel("encre")).toBe("Encre");
    expect(themeLabel("accent")).toBe("Accent");
    expect(themeHint("encre")).toContain("sombre");
    expect(themeLabel("inconnu" as "encre")).toBe("Papier");
  });

  it("applique un thème au canevas, aux formes et à la pastille", () => {
    expect(themeCanvasClass("encre")).toContain("bg-foreground");
    expect(themeShapeClass("encre")).toContain("bg-background/10");
    expect(themeLineClass("encre")).toBe("bg-background/40");
    expect(themeCanvasClass("accent")).toContain("text-accent-foreground");
    expect(themeSwatchClass("papier")).toBe("bg-card border-border");
    expect(themeCanvasClass("inconnu" as "encre")).toBe(themeCanvasClass("papier"));
  });
});
