import { describe, expect, it } from "vitest";
import { escapeHtml, renderMarkdown, slugify } from "../src/markdown.ts";

describe("sites — markdown", () => {
  it("échappe le HTML brut", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    const html = renderMarkdown("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("rend les titres, paragraphes et séparateurs", () => {
    const html = renderMarkdown("# Titre\n\nUn paragraphe.\n\n---");
    expect(html).toContain("<h1>Titre</h1>");
    expect(html).toContain("<p>Un paragraphe.</p>");
    expect(html).toContain("<hr />");
  });

  it("accepte jusqu'à 3 espaces devant un titre, pas 4", () => {
    const html = renderMarkdown("   # Titre\n\n    # pas un titre");
    expect(html).toBe("<h1>Titre</h1>\n<p>    # pas un titre</p>");
  });

  it("reconnaît toutes les variantes de séparateur", () => {
    const html = renderMarkdown("---\n\n* * *\n\n___\n\n- - -");
    expect(html.match(/<hr \/>/g)).toHaveLength(4);
  });

  it("rend les listes non ordonnées et ordonnées", () => {
    const html = renderMarkdown("- Alpha\n- Bêta\n\n1. Premier\n2. Second");
    expect(html).toContain("<ul>\n<li>Alpha</li>\n<li>Bêta</li>\n</ul>");
    expect(html).toContain("<ol>\n<li>Premier</li>\n<li>Second</li>\n</ol>");
  });

  it("capture le numéro de départ des listes ordonnées", () => {
    expect(renderMarkdown("3. trois\n4. quatre")).toBe(
      '<ol start="3">\n<li>trois</li>\n<li>quatre</li>\n</ol>',
    );
    expect(renderMarkdown("1. un")).toBe("<ol>\n<li>un</li>\n</ol>");
  });

  it("imbrique les listes selon l'indentation (2 espaces par niveau)", () => {
    const html = renderMarkdown("- A\n  - B\n- C");
    expect(html).toBe(
      ["<ul>", "<li>A", "<ul>", "<li>B</li>", "</ul>", "</li>", "<li>C</li>", "</ul>"].join("\n"),
    );
  });

  it("plafonne l'imbrication à 3 niveaux", () => {
    const html = renderMarkdown("- A\n  - B\n    - C\n        - D");
    expect(html.match(/<ul>/g)).toHaveLength(3);
    expect(html).toContain("<li>C</li>\n<li>D</li>");
  });

  it("rend gras, italique, code et liens http(s)", () => {
    const html = renderMarkdown("**gras** *italique* `code` [lien](https://exemple.org)");
    expect(html).toContain("<strong>gras</strong>");
    expect(html).toContain("<em>italique</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<a href="https://exemple.org"');
  });

  it("garde les segments de code opaques (ni lien, ni gras)", () => {
    const html = renderMarkdown("`[x](https://evil)` et `**b**`");
    expect(html).toBe("<p><code>[x](https://evil)</code> et <code>**b**</code></p>");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<strong>");

    const escaped = renderMarkdown("`<b>x</b>`");
    expect(escaped).toBe("<p><code>&lt;b&gt;x&lt;/b&gt;</code></p>");
  });

  it("ne confond pas les astérisques arithmétiques avec de l'italique", () => {
    expect(renderMarkdown("2 * 3 * 4")).toBe("<p>2 * 3 * 4</p>");
    expect(renderMarkdown("a * b * c")).toBe("<p>a * b * c</p>");
    expect(renderMarkdown("2 * 3 * 4")).not.toContain("<em>");
  });

  it("regroupe les lignes de prose dans un même paragraphe", () => {
    const html = renderMarkdown("Ligne un\nLigne deux\n\nSuite");
    expect(html).toBe("<p>Ligne un\nLigne deux</p>\n<p>Suite</p>");
    expect(html).not.toContain("<br");
  });

  it("regroupe une citation multi-lignes dans un seul bloc", () => {
    const html = renderMarkdown("> Ligne un\n> Ligne deux\n\nAprès");
    expect(html).toBe("<blockquote>Ligne un\nLigne deux</blockquote>\n<p>Après</p>");
    expect(html.match(/<blockquote>/g)).toHaveLength(1);
  });

  it("refuse les liens non http(s)", () => {
    const html = renderMarkdown("[clic](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).toContain("[clic](javascript:alert(1))");
  });

  it("rend les citations et blocs de code", () => {
    const html = renderMarkdown("> Citation\n\n```\nconst x = 1 < 2;\n```");
    expect(html).toContain("<blockquote>Citation</blockquote>");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("const x = 1 &lt; 2;");
  });

  it("normalise les retours chariot isolés", () => {
    expect(renderMarkdown("# Titre\rParagraphe")).toBe("<h1>Titre</h1>\n<p>Paragraphe</p>");
    expect(renderMarkdown("Ligne un\r\nLigne deux")).toBe("<p>Ligne un\nLigne deux</p>");
  });

  it("génère des slugs stables", () => {
    expect(slugify("Guide d'accueil")).toBe("guide-d-accueil");
    expect(slugify("Été 2026 — Résumé")).toBe("ete-2026-resume");
    expect(slugify("###")).toBe("page");
  });
});
