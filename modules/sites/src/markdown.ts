/**
 * Rendu Markdown minimal et **sûr** pour les pages de Sites.
 * Le texte est d'abord échappé (aucun HTML brut accepté), puis seules les
 * transformations Markdown connues sont appliquées ; les liens sont limités
 * à http(s). Le rendu est pur et testé.
 */

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Marqueur interne des segments de code (opaque au reste des règles). */
const CODE_PLACEHOLDER = "\u0000";

/**
 * Transformations en ligne. Les segments `` `code` `` sont extraits avant les
 * autres règles puis restaurés : ils restent **opaques** (un `[lien]` ou un
 * `**gras**` à l'intérieur n'est jamais transformé).
 */
function inline(text: string): string {
  let output = escapeHtml(text);

  const codeSpans: string[] = [];
  output = output.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const index = codeSpans.push(code) - 1;
    return `${CODE_PLACEHOLDER}${index}${CODE_PLACEHOLDER}`;
  });

  output = output.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // L'astérisque ouvrante doit être immédiatement suivie d'un non-blanc et la
  // fermante immédiatement précédée d'un non-blanc : « 2 * 3 * 4 » reste donc
  // du texte brut, contrairement à `*italique*`.
  output = output.replace(/\*(?!\s)([^*\n]*?[^\s*])\*/g, "<em>$1</em>");
  output = output.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" rel="noreferrer" target="_blank">$1</a>',
  );

  return output.replace(
    new RegExp(`${CODE_PLACEHOLDER}(\\d+)${CODE_PLACEHOLDER}`, "g"),
    (_match, index: string) => `<code>${codeSpans[Number(index)] ?? ""}</code>`,
  );
}

/** Une liste ouverte (imbrication suivie en profondeur, niveaux max 3). */
type ListFrame = {
  type: "ul" | "ol";
  /** Un `<li>` de ce niveau contient une liste imbriquée et reste ouvert. */
  itemOpen: boolean;
  /** Le dernier élément émis à ce niveau est un `<li>` refermable. */
  lastItemOpen: boolean;
};

const LIST_ITEM = /^( *)([-*])\s+(.*)$/;
const ORDERED_ITEM = /^( *)(\d{1,9})\.\s+(.*)$/;

/** Profondeur de liste : 2 espaces par niveau, plafonnée à 3. */
function listLevel(indent: string): number {
  return Math.min(3, Math.floor(indent.length / 2) + 1);
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  const listStack: ListFrame[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${inline(paragraph.join("\n"))}</p>`);
    paragraph = [];
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    html.push(`<blockquote>${inline(quote.join("\n"))}</blockquote>`);
    quote = [];
  };

  const closeFrame = () => {
    const frame = listStack.at(-1);
    if (!frame) return;
    if (frame.itemOpen) html.push("</li>");
    html.push(`</${frame.type}>`);
    listStack.pop();
  };

  const closeLists = () => {
    while (listStack.length > 0) closeFrame();
  };

  const flushBlocks = () => {
    flushParagraph();
    flushQuote();
    closeLists();
  };

  const openList = (type: "ul" | "ol", start: number) => {
    html.push(type === "ol" && start !== 1 ? `<ol start="${start}">` : `<${type}>`);
    listStack.push({ type, itemOpen: false, lastItemOpen: false });
  };

  const writeItem = (level: number, type: "ul" | "ol", content: string, start: number) => {
    while (listStack.length > level) closeFrame();
    const sameLevel = listStack.at(-1);
    if (listStack.length === level && sameLevel && sameLevel.type !== type) closeFrame();
    while (listStack.length < level) {
      const parent = listStack.at(-1);
      if (parent?.lastItemOpen) {
        // La liste imbriquée doit vivre dans le <li> précédent : on le rouvre.
        const last = html.length - 1;
        const current = html[last];
        if (current?.endsWith("</li>")) {
          html[last] = current.slice(0, -"</li>".length);
          parent.itemOpen = true;
          parent.lastItemOpen = false;
        }
      }
      openList(type, start);
    }
    const frame = listStack.at(-1);
    if (!frame) return;
    if (frame.itemOpen) {
      html.push("</li>");
      frame.itemOpen = false;
    }
    html.push(`<li>${inline(content)}</li>`);
    frame.lastItemOpen = true;
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushBlocks();
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }
    if (/^\s*$/.test(line)) {
      flushBlocks();
      continue;
    }

    const heading = /^( {0,3})(#{1,6})\s+(.*)$/.exec(line);
    if (heading?.[2] && heading[3] !== undefined) {
      flushBlocks();
      const level = heading[2].length;
      html.push(`<h${level}>${inline(heading[3])}</h${level}>`);
      continue;
    }

    if (/^ {0,3}(---+|\* \* \*|\*{3,}|___+|- - -)\s*$/.test(line)) {
      flushBlocks();
      html.push("<hr />");
      continue;
    }

    const quoteLine = /^ {0,3}> ?(.*)$/.exec(line);
    if (quoteLine) {
      flushParagraph();
      closeLists();
      quote.push(quoteLine[1] ?? "");
      continue;
    }

    const unordered = LIST_ITEM.exec(line);
    if (unordered?.[1] !== undefined && unordered[2] !== undefined && unordered[3] !== undefined) {
      flushParagraph();
      flushQuote();
      writeItem(listLevel(unordered[1]), "ul", unordered[3], 1);
      continue;
    }

    const ordered = ORDERED_ITEM.exec(line);
    if (ordered?.[1] !== undefined && ordered[2] !== undefined && ordered[3] !== undefined) {
      flushParagraph();
      flushQuote();
      writeItem(listLevel(ordered[1]), "ol", ordered[3], Number.parseInt(ordered[2], 10));
      continue;
    }

    flushQuote();
    closeLists();
    paragraph.push(line);
  }

  flushBlocks();
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}

/** Slug d'URL stable à partir d'un titre de page. */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base.slice(0, 80) : "page";
}
