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

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: sanitisation volontaire des URL
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/**
 * Liste blanche de couleur pour les marques de texte : un jeton sémantique
 * (`var(--jeton)`) ou une couleur hexadécimale, jamais une valeur libre —
 * l'export ne peut pas devenir un vecteur d'injection CSS.
 */
const SAFE_CSS_COLOR = /^(?:var\(--[a-z0-9-]+\)|#[0-9a-f]{3,8})$/i;

/** Tailles de police acceptées à l'export (nombre + unité CSS courte). */
const SAFE_FONT_SIZE = /^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/;
/** Pile de polices sûre : lettres, chiffres, espaces, virgules, guillemets et tirets uniquement. */
const SAFE_FONT_FAMILY = /^[\w\s,"'-]{1,120}$/;

/**
 * Valeur de couleur sûre pour l'export HTML : jeton sémantique ou hexadécimal.
 * `null` pour toute autre valeur (rien n'est jamais interpolé tel quel).
 */
function safeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SAFE_CSS_COLOR.test(trimmed) ? trimmed : null;
}

/**
 * Liste blanche d'URL : http(s) et mailto uniquement, caractères de contrôle
 * retirés (le contournement « java\tscript: » est ainsi fermé). Retourne
 * `null` pour tout autre schéma (javascript:, data:, vbscript:…).
 */
function sanitizeUrl(raw: string): string | null {
  const stripped = raw.replace(CONTROL_CHARS, "").trim();
  if (!/^(https?:|mailto:)/i.test(stripped)) return null;
  return stripped;
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
      else if (mark.type === "code") {
        const raw = node.text ?? "";
        const fence = raw.includes("`") ? "``" : "`";
        text = `${fence}${raw}${fence}`;
      } else if (mark.type === "strike") text = `~~${text}~~`;
      else if (mark.type === "link") {
        const href = linkHref(node);
        const safe = href ? sanitizeUrl(href) : null;
        if (safe) text = `[${text}](${safe.replace(/\)/g, "%29").replace(/\s/g, "%20")})`;
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

    case "taskList":
      return `${children
        .map(
          (item) =>
            `${indent}- [${item.attrs?.checked === true ? "x" : " "}] ${listItemMarkdown(item, depth + 1)}`,
        )
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

    case "image": {
      const src = sanitizeUrl(typeof node.attrs?.src === "string" ? node.attrs.src : "");
      if (!src) return "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return `![${escapeMarkdown(alt)}](${src})\n\n`;
    }

    case "pageBreak":
      return "---\n\n";

    case "table":
      return `${tableMarkdown(node)}\n\n`;

    default:
      return children.map((child) => blockMarkdown(child)).join("");
  }
}

/** Tableau ProseMirror → tableau Markdown (première ligne en en-tête). */
function tableMarkdown(table: PmNode): string {
  const cellsOf = (row: PmNode): string[] =>
    (row.content ?? []).map((cell) =>
      inlineMarkdown(cell).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim(),
    );
  const rows = (table.content ?? []).filter((row) => row.type === "tableRow").map(cellsOf);
  const [header = [], ...body] = rows;
  if (header.length === 0) return "";
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const row of body) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
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
  return `${blockMarkdown(doc).trimEnd()}\n`;
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
      else if (mark.type === "underline") text = `<u>${text}</u>`;
      else if (mark.type === "superscript") text = `<sup>${text}</sup>`;
      else if (mark.type === "subscript") text = `<sub>${text}</sub>`;
      else if (mark.type === "link") {
        const href = linkHref(node);
        const safe = href ? sanitizeUrl(href) : null;
        if (safe) {
          text = `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${text}</a>`;
        }
      } else if (mark.type === "textStyle") {
        const color = safeColor(mark.attrs?.color);
        const rawSize = mark.attrs?.fontSize;
        const fontSize =
          typeof rawSize === "string" && SAFE_FONT_SIZE.test(rawSize.trim())
            ? rawSize.trim()
            : null;
        const rawFamily = mark.attrs?.fontFamily;
        const fontFamily =
          typeof rawFamily === "string" && SAFE_FONT_FAMILY.test(rawFamily.trim())
            ? rawFamily.trim()
            : null;
        const styles = [
          color ? `color: ${color}` : null,
          fontSize ? `font-size: ${fontSize}` : null,
          fontFamily ? `font-family: ${fontFamily}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join("; ");
        if (styles.length > 0) text = `<span style="${escapeHtml(styles)}">${text}</span>`;
      } else if (mark.type === "highlight") {
        const color = safeColor(mark.attrs?.color);
        text = color
          ? `<mark style="background-color: ${escapeHtml(color)}">${text}</mark>`
          : `<mark>${text}</mark>`;
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

    case "taskList":
      return `<ul class="task-list">\n${children
        .map(
          (item) =>
            `  <li><input type="checkbox" disabled${item.attrs?.checked === true ? " checked" : ""} /> ${listItemHtml(item)}</li>`,
        )
        .join("\n")}\n</ul>`;

    case "blockquote":
      return `<blockquote>\n${children.map(blockHtml).join("\n")}\n</blockquote>`;

    case "codeBlock": {
      const code = escapeHtml(children.map((child) => child.text ?? "").join(""));
      return `<pre><code>${code}</code></pre>`;
    }

    case "horizontalRule":
      return "<hr />";

    case "image": {
      const src = sanitizeUrl(typeof node.attrs?.src === "string" ? node.attrs.src : "");
      if (!src) return "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
    }

    case "pageBreak":
      return `<hr class="page-break" />`;

    case "table":
      return tableHtml(node);

    default:
      return children.map(blockHtml).join("\n");
  }
}

/** Tableau ProseMirror → tableau HTML (première ligne en en-tête). */
function tableHtml(table: PmNode): string {
  const rows = (table.content ?? []).filter((row) => row.type === "tableRow");
  const rendered = rows.map((row, rowIndex) => {
    const cells = (row.content ?? []).map((cell) => {
      const tag = cell.type === "tableHeader" || rowIndex === 0 ? "th" : "td";
      return `  <${tag}>${inlineHtml(cell)}</${tag}>`;
    });
    return `<tr>\n${cells.join("\n")}\n</tr>`;
  });
  return `<table>\n<tbody>\n${rendered.join("\n")}\n</tbody>\n</table>`;
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
    if (
      node.type === "paragraph" ||
      node.type === "heading" ||
      node.type === "listItem" ||
      node.type === "taskItem"
    ) {
      parts.push("\n");
    }
  };
  walk(doc);
  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
