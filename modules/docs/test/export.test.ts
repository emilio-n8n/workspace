import { describe, expect, it } from "vitest";
import { type PmNode, toHtml, toMarkdown, toPlainText } from "../src/export.ts";

const richDocument: PmNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Titre principal" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Un texte " },
        { type: "text", text: "gras", marks: [{ type: "bold" }] },
        { type: "text", text: " et " },
        { type: "text", text: "italique", marks: [{ type: "italic" }] },
        { type: "text", text: " avec un " },
        {
          type: "text",
          text: "lien",
          marks: [{ type: "link", attrs: { href: "https://exemple.org" } }],
        },
        { type: "text", text: "." },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Bêta" }] }],
        },
      ],
    },
    {
      type: "orderedList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Premier" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const x = 1 < 2;" }],
    },
    { type: "horizontalRule" },
    {
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Citation" }] }],
    },
  ],
};

describe("export — Markdown", () => {
  it("convertit titres, gras, italique, liens, listes et code", () => {
    const markdown = toMarkdown(richDocument);

    expect(markdown).toContain("# Titre principal");
    expect(markdown).toContain("**gras**");
    expect(markdown).toContain("*italique*");
    expect(markdown).toContain("[lien](https://exemple.org)");
    expect(markdown).toContain("- Alpha\n- Bêta");
    expect(markdown).toContain("1. Premier\n2. Second");
    expect(markdown).toContain("```ts\nconst x = 1 < 2;\n```");
    expect(markdown).toContain("> Citation");
    expect(markdown).toContain("---");
  });

  it("échappe les caractères Markdown dans le texte", () => {
    const doc: PmNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "2 * 3 = 6 [pas un lien]" }] },
      ],
    };
    const markdown = toMarkdown(doc);
    expect(markdown).toContain("2 \\* 3 = 6 \\[pas un lien\\]");
  });
});

describe("export — HTML", () => {
  it("produit du HTML valide et échappé", () => {
    const doc: PmNode = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Fiche <script>" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Paul & fils " },
            { type: "text", text: "souligné", marks: [{ type: "underline" }] },
          ],
        },
      ],
    };

    const html = toHtml(doc);
    expect(html).toContain("<h2>Fiche &lt;script&gt;</h2>");
    expect(html).toContain("Paul &amp; fils");
    expect(html).not.toContain("<script>");
  });

  it("neutralise les liens javascript: en HTML", () => {
    const doc: PmNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "cliquez",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };
    const html = toHtml(doc);
    expect(html).not.toContain("javascript:");
  });
});

describe("export — texte brut", () => {
  it("extrait le texte avec les séparateurs de blocs", () => {
    const text = toPlainText(richDocument);
    expect(text).toContain("Titre principal");
    expect(text).toContain("Un texte gras et italique");
    expect(text).toContain("Alpha");
    expect(text).not.toContain("**");
  });
});
