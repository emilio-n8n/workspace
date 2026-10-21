import { describe, expect, it } from "vitest";
import type { EditorElement } from "../src/editor-model.ts";
import {
  clipboardFromHtml,
  clipboardFromStorage,
  clipboardHtml,
  makeClipboard,
  pastedPosition,
} from "../src/slide-clipboard.ts";
import {
  elapsedMs,
  nextSlideIndex,
  nextSlideLabel,
  pauseTimer,
  resetTimer,
  resumeTimer,
  startTimer,
} from "../src/slide-presenter.ts";
import {
  clearRunMark,
  displayRuns,
  normalizeRuns,
  RichTextError,
  runsToHtml,
  treeToRuns,
  validateRuns,
} from "../src/slide-rich-text.ts";
import { rotationFromPointer } from "../src/slide-rotate.ts";

const base = { bold: false, italic: false, underline: false, textColor: "default" as const };

describe("poignée de rotation", () => {
  const center = { x: 100, y: 100 };
  it("suit le pointeur autour du centre (poignée en haut = 0°)", () => {
    expect(rotationFromPointer(center, { x: 100, y: 0 }, false)).toBe(0);
    expect(rotationFromPointer(center, { x: 200, y: 100 }, false)).toBe(90);
    expect(rotationFromPointer(center, { x: 100, y: 200 }, false)).toBe(180);
    expect(rotationFromPointer(center, { x: 0, y: 100 }, false)).toBe(270);
    expect(rotationFromPointer(center, { x: 110, y: 0 }, false)).toBe(6);
  });
  it("Maj aimante par pas de 15°", () => {
    expect(rotationFromPointer(center, { x: 110, y: 0 }, true)).toBe(0);
    expect(rotationFromPointer(center, { x: 160, y: 40 }, true)).toBe(45);
    expect(rotationFromPointer(center, { x: 100, y: 100 }, true)).toBe(0);
    expect(rotationFromPointer(center, { x: 99, y: 0 }, true)).toBe(0);
  });
});

describe("mode présentateur", () => {
  it("minuteur avec pause, reprise et remise à zéro", () => {
    let timer = startTimer(1_000);
    expect(elapsedMs(timer, 4_000)).toBe(3_000);
    timer = pauseTimer(timer, 4_000);
    expect(elapsedMs(timer, 60_000)).toBe(3_000);
    timer = resumeTimer(timer, 10_000);
    expect(elapsedMs(timer, 12_000)).toBe(5_000);
    expect(elapsedMs(resetTimer(timer, 12_000), 13_000)).toBe(1_000);
    expect(pauseTimer(pauseTimer(timer, 12_000), 20_000)).toEqual(pauseTimer(timer, 12_000));
  });
  it("diapositive suivante et fin du diaporama", () => {
    expect(nextSlideIndex(0, 3)).toBe(1);
    expect(nextSlideIndex(2, 3)).toBeNull();
    expect(nextSlideLabel(0, 3)).toBe("Suivante : diapositive 2 sur 3");
    expect(nextSlideLabel(2, 3)).toBe("Fin du diaporama");
  });
});

describe("texte enrichi par mot", () => {
  it("normalise : marques héritées retirées, voisins fusionnés, texte brut → null", () => {
    expect(
      normalizeRuns(
        [
          { text: "Bon", bold: false },
          { text: "jour ", bold: false },
          { text: "monde", bold: true },
        ],
        base,
      ),
    ).toEqual([{ text: "Bonjour " }, { text: "monde", bold: true }]);
    expect(normalizeRuns([{ text: "abc", bold: true }], { ...base, bold: true })).toBeNull();
    expect(normalizeRuns([{ text: "" }, { text: "x", color: "default" }], base)).toBeNull();
  });
  it("affiche les segments seulement s'ils correspondent au texte", () => {
    const runs = [{ text: "a" }, { text: "b", italic: true }];
    expect(displayRuns("ab", runs)).toEqual(runs);
    expect(displayRuns("changé", runs)).toEqual([{ text: "changé" }]);
    expect(displayRuns("", null)).toEqual([]);
    expect(clearRunMark(runs, "italic")).toBeNull();
    expect(clearRunMark([{ text: "a", bold: true, italic: true }], "italic")).toEqual([
      { text: "a", bold: true },
    ]);
  });
  it("valide strictement côté service", () => {
    expect(validateRuns([{ text: "a" }, { text: "b", underline: true }], "ab")).toEqual([
      { text: "a" },
      { text: "b", underline: true },
    ]);
    expect(() => validateRuns([{ text: "a" }], "ab")).toThrow(RichTextError);
    expect(() => validateRuns([{ text: "a", size: 3 }], "a")).toThrow(RichTextError);
    expect(() => validateRuns([{ text: "a", color: "rose" }], "a")).toThrow(RichTextError);
    expect(validateRuns(null, "x")).toBeNull();
  });
  it("lit l'arbre de l'éditeur : balises, styles, couleurs, sauts de ligne", () => {
    const runs = treeToRuns(
      [
        { type: "text", text: "Un " },
        { type: "element", tag: "B", children: [{ type: "text", text: "mot" }] },
        {
          type: "element",
          tag: "SPAN",
          color: "accent",
          children: [{ type: "text", text: " vert" }],
        },
        {
          type: "element",
          tag: "DIV",
          children: [{ type: "element", tag: "I", children: [{ type: "text", text: "ligne 2" }] }],
        },
        {
          type: "element",
          tag: "SPAN",
          bold: false,
          children: [{ type: "element", tag: "BR", children: [] }],
        },
      ],
      base,
    );
    expect(normalizeRuns(runs, base)).toEqual([
      { text: "Un " },
      { text: "mot", bold: true },
      { text: " vert", color: "accent" },
      { text: "\n" },
      { text: "ligne 2", italic: true },
      { text: "\n" },
    ]);
  });
  it("produit le HTML d'amorçage échappé", () => {
    const html = runsToHtml([{ text: "<a>\nb", bold: true }], base, (color) => `c-${color}`);
    expect(html).toContain("&lt;a&gt;<br>b");
    expect(html).toContain("font-weight:700");
    expect(html).toContain('data-color="default"');
  });
});

describe("presse-papiers entre présentations", () => {
  const element = {
    key: "k1",
    id: "e1",
    kind: "text",
    x: 90,
    y: 10,
    w: 20,
    h: 10,
    text: "Bonjour",
    fontSize: 24,
    bold: false,
    italic: false,
    underline: false,
    textColor: "default",
    placeholder: null,
    align: "left",
    fill: "theme",
    rotation: 0,
  } as EditorElement;

  it("aller-retour HTML et copie locale, sans clé ni identifiant", () => {
    const clip = makeClipboard("fichier-1", [element], 1_000);
    expect(clip.elements[0]).not.toHaveProperty("key");
    expect(clip.elements[0]).not.toHaveProperty("id");
    const html = clipboardHtml(clip, "Bonjour <é>");
    expect(html).toContain("Bonjour &lt;é&gt;");
    expect(clipboardFromHtml(html, 2_000)).toEqual(clip);
    expect(clipboardFromHtml("<b>rien</b>", 2_000)).toBeNull();
    expect(clipboardFromStorage(JSON.stringify(clip), 2_000)).toEqual(clip);
    expect(clipboardFromStorage(JSON.stringify(clip), 1_000 + 2 * 60 * 60 * 1000)).toBeNull();
    expect(clipboardFromStorage("{pas du json", 2_000)).toBeNull();
  });
  it("position collée bornée dans la diapositive", () => {
    expect(pastedPosition(element, 4)).toEqual({ x: 80, y: 14 });
    expect(pastedPosition({ ...element, x: 10 }, 0)).toEqual({ x: 10, y: 10 });
  });
});

describe("rotation relative à la prise", () => {
  it("ajoute l'angle parcouru, sans saut quand la poignée est en dessous", async () => {
    const { rotateFromDrag } = await import("../src/slide-rotate.ts");
    const center = { x: 0, y: 0 };
    // Prise en dessous (180°), pointeur amené à gauche (270°) : +90°.
    expect(rotateFromDrag(0, center, { x: 0, y: 50 }, { x: -50, y: 0 }, false)).toBe(90);
    expect(rotateFromDrag(30, center, { x: 0, y: -50 }, { x: 50, y: -50 }, false)).toBe(75);
    expect(rotateFromDrag(30, center, { x: 0, y: -50 }, { x: 50, y: -50 }, true)).toBe(75);
    expect(rotateFromDrag(32, center, { x: 0, y: -50 }, { x: 1, y: -50 }, true)).toBe(30);
    expect(rotateFromDrag(350, center, { x: 0, y: -50 }, { x: 50, y: 0 }, false)).toBe(80);
  });
});
