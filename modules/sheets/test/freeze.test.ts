import { describe, expect, it } from "vitest";
import {
  DEFAULT_FREEZE,
  freezeAnnouncement,
  freezeButtonLabel,
  freezeClasses,
  freezeHint,
  toggleFreeze,
} from "../src/freeze.ts";

describe("sheets — figement des repères", () => {
  it("fige les deux repères par défaut", () => {
    expect(DEFAULT_FREEZE).toEqual({ header: true, firstColumn: true });
  });

  it("n'applique le collage que là où le repère est figé", () => {
    const frozen = freezeClasses({ header: true, firstColumn: true });
    expect(frozen.header).toContain("sticky top-0");
    expect(frozen.firstColumn).toContain("sticky left-0");
    expect(frozen.corner).toContain("sticky top-0");
    expect(frozen.corner).toContain("sticky left-0");

    const none = freezeClasses({ header: false, firstColumn: false });
    expect(none.header).not.toContain("sticky");
    expect(none.firstColumn).not.toContain("sticky");
    expect(none.corner).not.toContain("sticky");

    const headerOnly = freezeClasses({ header: true, firstColumn: false });
    expect(headerOnly.header).toContain("sticky top-0");
    expect(headerOnly.firstColumn).not.toContain("sticky");
    // Le coin suit la ligne : il reste collé en hauteur, pas en largeur.
    expect(headerOnly.corner).toContain("sticky top-0");
    expect(headerOnly.corner).not.toContain("sticky left-0");
  });

  it("superpose les repères au-dessus des cellules qui défilent", () => {
    const classes = freezeClasses({ header: true, firstColumn: true });
    expect(classes.header).toContain("z-10");
    expect(classes.firstColumn).toContain("z-10");
    expect(classes.corner).toContain("z-20");
  });

  it("inverse un repère sans toucher à l'autre", () => {
    expect(toggleFreeze({ header: true, firstColumn: true }, "header")).toEqual({
      header: false,
      firstColumn: true,
    });
    expect(toggleFreeze({ header: false, firstColumn: true }, "firstColumn")).toEqual({
      header: false,
      firstColumn: false,
    });
  });

  it("formule son état en français", () => {
    expect(freezeHint({ header: true, firstColumn: true })).toBe(
      "En-tête et première colonne figés pendant le défilement.",
    );
    expect(freezeHint({ header: true, firstColumn: false })).toBe(
      "En-tête figé pendant le défilement.",
    );
    expect(freezeHint({ header: false, firstColumn: true })).toBe(
      "Première colonne figée pendant le défilement.",
    );
    expect(freezeHint({ header: false, firstColumn: false })).toContain("Aucun repère figé");
  });

  it("nomme les boutons et annonce les changements", () => {
    expect(freezeButtonLabel("header")).toBe("Figer l'en-tête");
    expect(freezeButtonLabel("firstColumn")).toBe("Figer la première colonne");
    expect(freezeAnnouncement({ header: true, firstColumn: false })).toBe("l'en-tête est figé.");
    expect(freezeAnnouncement({ header: true, firstColumn: true })).toContain("sont figés");
    expect(freezeAnnouncement({ header: false, firstColumn: false })).toBe("Aucun repère figé.");
  });
});
