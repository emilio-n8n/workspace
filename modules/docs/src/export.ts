/**
 * Conversion du JSON ProseMirror (sous-ensemble StarterKit) vers Markdown et
 * HTML. Aucune dépendance : le périmètre couvert est explicite et testé.
 */

export type PmMark = { type: string; attrs?: Record<string, unknown> };

export type PmNode = {
  type?: string;
  text?: string;
  content?: PmNode[];
  attrs?: Record<string, unknown>;
  marks?: PmMark[];
};

const MD_ESCAPE = /([\\`*_[\]])/g;

function escapeMarkdown(text: string): string {
  return text.replace(MD_ESCAPE, "\\$1");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkHref(node: PmNode): string | null {
  const link = node.marks?.find((mark) => mark.type === "link");
  const href = link?.attrs?.href;
  return typeof href === "string" ? href : null;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function inlineMarkdown(node: PmNode): string {
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "text") {
    let text = escapeMarkdown(node.text ?? "");
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") text = `**${text}**`;
      else if (mark.type === "italic") text = `*${text}*`;
      else if (mark.type === "code") text = `\`${node.text ?? ""}\``;
      else if (mark.type === "strike") text = `~~${text}~~`;
      else if (mark.type === "link") {
        const href = linkHref(node);
        if (href) text = `[${text}](${href})`;
      }
    }
    return text;
  }
  return (node.content ?? []).map(inlineMarkdown).join("");
}

function blockMarkdown(node: PmNode, depth = 0): string {
  const children = node.content ?? [];
  const indent = "  ".repeat(depth);

  switch (node.type) {
    case "doc":
      return children
        .map((child) => blockMarkdown(child))
        .join("")
        .replace(/\n{3,}/g, "\n\n");

    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${inlineMarkdown(node)}\n\n`;
    }

    case "paragraph":
      return `${inlineMarkdown(node)}\n\n`;

    case "bulletList":
      return `${children
        .map((item) => `${indent}- ${listItemMarkdown(item, depth + 1)}`)
        .join("\n")}\n\n`;

    case "orderedList":
      return `${children
        .map((item, index) => `${indent}${index + 1}. ${listItemMarkdown(item, depth + 1)}`)
        .join("\n")}\n\n`;

    case "blockquote": {
      const inner = children
        .map((child) => blockMarkdown(child))
        .join("")
        .trimEnd();
      return `${inner
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    }

    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const code = children.map((child) => child.text ?? "").join("");
      return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }

    case "horizontalRule":
      return "---\n\n";

    default:
      return children.map((child) => blockMarkdown(child)).join("");
  }
}

function listItemMarkdown(item: PmNode, depth: number): string {
  const parts = (item.content ?? []).map((child) => {
    if (child.type === "paragraph") return inlineMarkdown(child);
    return blockMarkdown(child, depth).trim();
  });
  const [first = "", ...rest] = parts;
  return [first, ...rest.map((part) => `\n${"  ".repeat(depth)}${part}`)].join("");
}

/** Convertit un document ProseMirror en Markdown. */
export function toMarkdown(doc: PmNode): string {
  return blockMarkdown(doc).trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function inlineHtml(node: PmNode): string {
  if (node.type === "hardBreak") return "<br />";
  if (node.type === "text") {
    let text = escapeHtml(node.text ?? "");
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") text = `<strong>${text}</strong>`;
      else if (mark.type === "italic") text = `<em>${text}</em>`;
      else if (mark.type === "code") text = `<code>${text}</code>`;
      else if (mark.type === "strike") text = `<s>${text}</s>`;
      else if (mark.type === "link") {
        const href = linkHref(node);
        if (href) {
          const safeHref = escapeHtml(href).replace(/^javascript:/i, "#");
          text = `<a href="${safeHref}" rel="noopener noreferrer">${text}</a>`;
        }
      }
    }
    return text;
  }
  return (node.content ?? []).map(inlineHtml).join("");
}

function blockHtml(node: PmNode): string {
  const children = node.content ?? [];
  switch (node.type) {
    case "doc":
      return children.map(blockHtml).join("\n");

    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      const tag = `h${Math.min(Math.max(level, 1), 6)}`;
      return `<${tag}>${inlineHtml(node)}</${tag}>`;
    }

    case "paragraph":
      return `<p>${inlineHtml(node)}</p>`;

    case "bulletList":
      return `<ul>\n${children
        .map((item) => `  <li>${listItemHtml(item)}</li>`)
        .join("\n")}\n</ul>`;

    case "orderedList":
      return `<ol>\n${children
        .map((item) => `  <li>${listItemHtml(item)}</li>`)
        .join("\n")}\n</ol>`;

    case "blockquote":
      return `<blockquote>\n${children.map(blockHtml).join("\n")}\n</blockquote>`;

    case "codeBlock": {
      const code = escapeHtml(children.map((child) => child.text ?? "").join(""));
      return `<pre><code>${code}</code></pre>`;
    }

    case "horizontalRule":
      return "<hr />";

    default:
      return children.map(blockHtml).join("\n");
  }
}

function listItemHtml(item: PmNode): string {
  return (item.content ?? [])
    .map((child) => (child.type === "paragraph" ? inlineHtml(child) : blockHtml(child)))
    .join("");
}

/** Convertit un document ProseMirror en HTML autonome (fragment de contenu). */
export function toHtml(doc: PmNode): string {
  return blockHtml(doc);
}

/** Texte brut (recherche, agents) — préserve les sauts de blocs. */
export function toPlainText(doc: PmNode): string {
  const parts: string[] = [];
  const walk = (node: PmNode) => {
    if (node.type === "text") {
      parts.push(node.text ?? "");
      return;
    }
    if (node.type === "hardBreak") {
      parts.push("\n");
      return;
    }
    for (const child of node.content ?? []) walk(child);
    if (node.type === "paragraph" || node.type === "heading" || node.type === "listItem") {
      parts.push("\n");
    }
  };
  walk(doc);
  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
