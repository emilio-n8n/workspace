import { describe, expect, it } from "vitest";
import { DOC_FONT_FAMILIES, fontFamilyIdOf } from "../src/doc-format.ts";
import {
  LINE_HEIGHTS,
  MAX_INDENT,
  normalizeIndent,
  normalizeLineHeight,
} from "../src/editor-extensions.ts";
import { toHtml, toMarkdown, toPlainText } from "../src/export.ts";
import {
  DEFAULT_PAGE_SETUP,
  marginPresetOf,
  normalizePageSetup,
  pageGeometry,
  pageSizeMm,
  printPageRule,
  rulerTicks,
} from "../src/page-setup.ts";
import { formatReplaced } from "../src/search-text.ts";

describe("docs v3 — mise en page", () => {
  it("relit un document sans mise en page comme A4 portrait, marges normales", () => {
    expect(normalizePageSetup(undefined)).toEqual(DEFAULT_PAGE_SETUP);
    expect(normalizePageSetup(null)).toEqual(DEFAULT_PAGE_SETUP);
    expect(marginPresetOf(DEFAULT_PAGE_SETUP.margins)).toBe("normal");
  });

  it("borne les marges et rejette les formats inconnus", () => {
    const setup = normalizePageSetup({
      size: "tabloid",
      orientation: "landscape",
      margins: { top: -4, right: 500, bottom: "12.34", left: "x" },
    });
    expect(setup.size).toBe("a4");
    expect(setup.orientation).toBe("landscape");
    expect(setup.margins).toEqual({ top: 0, right: 80, bottom: 12.3, left: 25 });
  });

  it("inverse largeur et hauteur en paysage", () => {
    expect(pageSizeMm({ ...DEFAULT_PAGE_SETUP, orientation: "landscape" })).toEqual({
      width: 297,
      height: 210,
    });
    expect(pageSizeMm({ ...DEFAULT_PAGE_SETUP, size: "letter" }).width).toBeCloseTo(215.9);
  });

  it("calcule la feuille à 96 ppp et garde une zone de texte d'au moins 2 cm", () => {
    const geometry = pageGeometry(DEFAULT_PAGE_SETUP);
    expect(geometry.width).toBe(794);
    expect(geometry.height).toBe(1123);
    expect(geometry.padding.left).toBe(94);
    const extreme = pageGeometry({
      ...DEFAULT_PAGE_SETUP,
      size: "a5",
      margins: { top: 10, right: 80, bottom: 10, left: 80 },
    });
    expect(extreme.contentWidth).toBeGreaterThanOrEqual(75);
  });

  it("produit la règle @page d'impression", () => {
    expect(printPageRule(DEFAULT_PAGE_SETUP)).toBe(
      "@page { size: 210mm 297mm; margin: 25mm 25mm 25mm 25mm; }",
    );
  });

  it("numérote la règle en centimètres depuis la marge gauche", () => {
    const ticks = rulerTicks(DEFAULT_PAGE_SETUP);
    const origin = ticks.find((tick) => tick.mm === 25);
    expect(origin).toEqual({ mm: 25, major: true, label: null });
    expect(ticks.find((tick) => tick.mm === 35)?.label).toBe("1");
    expect(ticks.find((tick) => tick.mm === 15)?.label).toBe("1");
    expect(ticks.find((tick) => tick.mm === 30)?.major).toBe(false);
  });
});

describe("docs v3 — police, interligne et retrait", () => {
  it("reconnaît les polices du catalogue et la première famille d'une pile collée", () => {
    expect(fontFamilyIdOf(undefined)).toBe("default");
    expect(fontFamilyIdOf("Georgia, serif")).toBe("georgia");
    expect(fontFamilyIdOf("Calibri, sans-serif")).toBe("calibri");
    expect(fontFamilyIdOf('"Times New Roman", serif')).toBe("times");
    expect(fontFamilyIdOf("Comic Sans MS")).toBeNull();
    expect(DOC_FONT_FAMILIES[0]?.css).toBeNull();
  });

  it("n'accepte que les interlignes du catalogue", () => {
    for (const option of LINE_HEIGHTS) expect(normalizeLineHeight(option.value)).toBe(option.value);
    expect(normalizeLineHeight(1.5)).toBe("1.5");
    expect(normalizeLineHeight("3")).toBeNull();
    expect(normalizeLineHeight("1;color:red")).toBeNull();
  });

  it("borne le retrait", () => {
    expect(normalizeIndent("3")).toBe(3);
    expect(normalizeIndent(-2)).toBe(0);
    expect(normalizeIndent(99)).toBe(MAX_INDENT);
    expect(normalizeIndent("abc")).toBe(0);
  });
});

describe("docs v3 — exports des nouveaux nœuds", () => {
  const doc = {
    type: "doc",
    attrs: { pageSetup: { size: "a4", orientation: "landscape" } },
    content: [
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Relire" }] }],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Envoyer" }] }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "H" },
          { type: "text", text: "2", marks: [{ type: "subscript" }] },
          { type: "text", text: "O et x" },
          { type: "text", text: "2", marks: [{ type: "superscript" }] },
          {
            type: "text",
            text: " serif",
            marks: [{ type: "textStyle", attrs: { fontFamily: "Georgia, serif" } }],
          },
        ],
      },
    ],
  };

  it("exporte les tâches en Markdown GFM", () => {
    expect(toMarkdown(doc)).toContain("- [x] Relire\n- [ ] Envoyer");
  });

  it("exporte cases, exposant, indice et police en HTML", () => {
    const html = toHtml(doc);
    expect(html).toContain('<input type="checkbox" disabled checked /> Relire');
    expect(html).toContain("H<sub>2</sub>O et x<sup>2</sup>");
    expect(html).toContain("font-family: Georgia, serif");
  });

  it("refuse une police injectée à l'export HTML", () => {
    const html = toHtml({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "textStyle", attrs: { fontFamily: "a;}</style><script>" } }],
            },
          ],
        },
      ],
    });
    expect(html).not.toContain("script");
    expect(html).toBe("<p>x</p>");
  });

  it("garde le texte brut des tâches", () => {
    expect(toPlainText(doc)).toContain("Relire");
    expect(toPlainText(doc)).toContain("Envoyer");
  });

  it("annonce le nombre de remplacements", () => {
    expect(formatReplaced(1)).toBe("1 remplacement effectué");
    expect(formatReplaced(3)).toBe("3 remplacements effectués");
  });
});
