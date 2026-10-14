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

describe("export — images, tableaux et saut de page", () => {
  const figureDocument: PmNode = {
    type: "doc",
    content: [
      {
        type: "image",
        attrs: { src: "https://exemple.org/photo.png", alt: "Photo de l'équipe" },
      },
      { type: "pageBreak" },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Nom" }] }],
              },
              {
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Rôle" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Ada" }] }],
              },
              {
                type: "tableCell",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Calcul | logique" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it("exporte une image valide et neutralise les schémas dangereux", () => {
    const markdown = toMarkdown(figureDocument);
    expect(markdown).toContain("![Photo de l'équipe](https://exemple.org/photo.png)");

    const unsafe: PmNode = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "javascript:alert(1)" } }],
    };
    expect(toMarkdown(unsafe)).not.toContain("javascript:");
    expect(toHtml(unsafe)).not.toContain("javascript:");
  });

  it("exporte le tableau et le saut de page en Markdown", () => {
    const markdown = toMarkdown(figureDocument);
    expect(markdown).toContain("| Nom | Rôle |");
    expect(markdown).toContain("| --- | --- |");
    expect(markdown).toContain("| Ada | Calcul \\| logique |");
    expect(markdown).toContain("---");
  });

  it("exporte le tableau et le saut de page en HTML", () => {
    const html = toHtml(figureDocument);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Nom</th>");
    expect(html).toContain("<td>Ada</td>");
    expect(html).toContain('<img src="https://exemple.org/photo.png" alt="Photo de l\'équipe" />');
    expect(html).toContain('<hr class="page-break" />');
  });

  it("exporte les styles sûrs et refuse les valeurs CSS libres", () => {
    const doc: PmNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "accent",
              marks: [{ type: "textStyle", attrs: { color: "var(--primary)", fontSize: "18px" } }],
            },
            {
              type: "text",
              text: " surligné",
              marks: [{ type: "highlight", attrs: { color: "var(--attention)" } }],
            },
            {
              type: "text",
              text: " dangereux",
              marks: [{ type: "textStyle", attrs: { color: "url(javascript:alert(1))" } }],
            },
          ],
        },
      ],
    };
    const html = toHtml(doc);
    expect(html).toContain('<span style="color: var(--primary); font-size: 18px">accent</span>');
    expect(html).toContain('<mark style="background-color: var(--attention)">');
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
