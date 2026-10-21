/**
 * Texte enrichi d'une zone de texte : mise en forme **par mot** (gras,
 * italique, souligné, couleur sémantique), comme PowerPoint.
 *
 * Modèle : une suite de segments (`runs`) dont la concaténation est exactement
 * le texte brut de l'élément (colonne `text`, toujours tenue à jour pour la
 * recherche, l'export et les anciens clients). Chaque marque est **relative à
 * l'élément** : absente = héritée (le gras de la zone s'applique), présente =
 * forcée (`bold: false` dégraisse un mot dans un titre gras). Stockage :
 * colonne additive `slide_elements.rich` (migration 0007).
 *
 * Logique pure, partagée par l'éditeur, le service (validation), l'export
 * .pptx et les tests.
 */
import { SLIDE_TEXT_COLOR_IDS, type SlideTextColor } from "./slide-text.ts";

export type TextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: SlideTextColor;
};

export const MAX_RUNS = 400;

/** Marques effectives d'un segment, une fois la zone appliquée. */
export type ResolvedRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: SlideTextColor;
};

export type RunBase = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textColor: SlideTextColor;
};

export function runsText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join("");
}

function sameMarks(a: TextRun, b: TextRun): boolean {
  return (
    a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.color === b.color
  );
}

/**
 * Normalise une suite de segments : marques égales à la zone retirées,
 * segments vides supprimés, voisins identiques fusionnés. `null` quand plus
 * aucun segment ne porte de marque (texte brut).
 */
export function normalizeRuns(runs: readonly TextRun[], base: RunBase): TextRun[] | null {
  const out: TextRun[] = [];
  for (const raw of runs) {
    if (raw.text.length === 0) continue;
    const run: TextRun = { text: raw.text };
    if (raw.bold !== undefined && raw.bold !== base.bold) run.bold = raw.bold;
    if (raw.italic !== undefined && raw.italic !== base.italic) run.italic = raw.italic;
    if (raw.underline !== undefined && raw.underline !== base.underline)
      run.underline = raw.underline;
    if (raw.color !== undefined && raw.color !== base.textColor) run.color = raw.color;
    const last = out[out.length - 1];
    if (last && sameMarks(last, run)) last.text += run.text;
    else out.push(run);
  }
  return out.some((run) => Object.keys(run).length > 1) ? out : null;
}

export function resolveRun(run: TextRun, base: RunBase): ResolvedRun {
  return {
    text: run.text,
    bold: run.bold ?? base.bold,
    italic: run.italic ?? base.italic,
    underline: run.underline ?? base.underline,
    color: run.color ?? base.textColor,
  };
}

/**
 * Segments affichés d'un élément : les segments enrichis s'ils correspondent
 * toujours au texte brut (sinon le texte a changé ailleurs, on retombe sur le
 * texte brut plutôt que d'afficher un contenu périmé).
 */
export function displayRuns(text: string, runs: readonly TextRun[] | null | undefined): TextRun[] {
  if (runs && runs.length > 0 && runsText(runs) === text) return [...runs];
  return text.length > 0 ? [{ text }] : [];
}

/**
 * Retire une marque de tous les segments : la mise en forme de la zone
 * (bouton Gras sans édition en cours) s'applique alors à tout le texte.
 */
export function clearRunMark(
  runs: readonly TextRun[] | null | undefined,
  mark: "bold" | "italic" | "underline" | "color",
): TextRun[] | null {
  if (!runs) return null;
  const next = runs.map((run) => {
    const copy = { ...run };
    delete copy[mark];
    return copy;
  });
  return next.some((run) => Object.keys(run).length > 1) ? next : null;
}

export class RichTextError extends Error {}

/** Validation stricte (service) : segments, marques, texte cohérent. */
export function validateRuns(value: unknown, text: string): TextRun[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length > MAX_RUNS) {
    throw new RichTextError(`Texte enrichi invalide (${MAX_RUNS} segments au plus).`);
  }
  const runs = value.map((raw): TextRun => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new RichTextError("Segment de texte invalide.");
    }
    const entry = raw as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (!["text", "bold", "italic", "underline", "color"].includes(key)) {
        throw new RichTextError(`Marque inconnue : ${key}.`);
      }
    }
    if (typeof entry.text !== "string") throw new RichTextError("Segment sans texte.");
    const run: TextRun = { text: entry.text };
    for (const mark of ["bold", "italic", "underline"] as const) {
      if (entry[mark] !== undefined) {
        if (typeof entry[mark] !== "boolean")
          throw new RichTextError(`« ${mark} » doit être booléen.`);
        run[mark] = entry[mark] as boolean;
      }
    }
    if (entry.color !== undefined) {
      if (!(SLIDE_TEXT_COLOR_IDS as readonly unknown[]).includes(entry.color)) {
        throw new RichTextError("Couleur de segment inconnue.");
      }
      run.color = entry.color as SlideTextColor;
    }
    return run;
  });
  if (runsText(runs) !== text) {
    throw new RichTextError("Le texte enrichi ne correspond pas au texte de l'élément.");
  }
  return runs.length > 0 ? runs : null;
}

/** Échappement HTML (rendu dans l'éditeur en place). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * HTML d'amorçage de l'éditeur en place (`contenteditable`) : un `span` par
 * segment, marques **effectives** en style, couleur en `data-color`.
 */
export function runsToHtml(
  runs: readonly TextRun[],
  base: RunBase,
  colorClass: (color: SlideTextColor) => string,
): string {
  return runs
    .map((run) => {
      const resolved = resolveRun(run, base);
      const style = [
        `font-weight:${resolved.bold ? 700 : 400}`,
        `font-style:${resolved.italic ? "italic" : "normal"}`,
        `text-decoration-line:${resolved.underline ? "underline" : "none"}`,
      ].join(";");
      const className = colorClass(resolved.color);
      return `<span data-color="${resolved.color}" class="${className}" style="${style}">${escapeHtml(run.text).replace(/\n/g, "<br>")}</span>`;
    })
    .join("");
}

/** Nœud lu par `domToRuns` (sous-ensemble du DOM, injectable dans les tests). */
export type RichNode =
  | { type: "text"; text: string }
  | {
      type: "element";
      tag: string;
      /** Marques déclarées par l'élément lui-même (balise, style, data-color). */
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      color?: SlideTextColor;
      children: RichNode[];
    };

const BLOCK_TAGS = new Set(["DIV", "P", "LI"]);

/**
 * Convertit l'arbre de l'éditeur en segments absolus : `b/strong`, `i/em`,
 * `u`, styles en ligne et `data-color` (couleurs) ; `br` et blocs = sauts de
 * ligne (Chromium insère des `div` à l'Entrée).
 */
export function treeToRuns(nodes: readonly RichNode[], base: RunBase): TextRun[] {
  const out: TextRun[] = [];
  const walk = (list: readonly RichNode[], marks: ResolvedRun, first: { value: boolean }) => {
    for (const node of list) {
      if (node.type === "text") {
        if (node.text.length > 0) {
          out.push({
            text: node.text,
            bold: marks.bold,
            italic: marks.italic,
            underline: marks.underline,
            color: marks.color,
          });
          first.value = false;
        }
        continue;
      }
      if (node.tag === "BR") {
        out.push({ text: "\n", ...markOf(marks) });
        continue;
      }
      const isBlock = BLOCK_TAGS.has(node.tag);
      if (isBlock && !first.value && !endsWithNewline(out))
        out.push({ text: "\n", ...markOf(marks) });
      const next: ResolvedRun = {
        text: "",
        bold: node.bold ?? (node.tag === "B" || node.tag === "STRONG" ? true : marks.bold),
        italic: node.italic ?? (node.tag === "I" || node.tag === "EM" ? true : marks.italic),
        underline: node.underline ?? (node.tag === "U" ? true : marks.underline),
        color: node.color ?? marks.color,
      };
      walk(node.children, next, first);
      // `<div><br></div>` : ligne vide — le `br` a déjà produit le saut.
    }
  };
  walk(
    nodes,
    {
      text: "",
      bold: base.bold,
      italic: base.italic,
      underline: base.underline,
      color: base.textColor,
    },
    { value: true },
  );
  // Un `br` final de Chromium (zone vide) ne compte pas.
  const last = out[out.length - 1];
  if (last && last.text === "\n" && out.length === 1) out.pop();
  return out;
}

function markOf(marks: ResolvedRun): Omit<TextRun, "text"> {
  return { bold: marks.bold, italic: marks.italic, underline: marks.underline, color: marks.color };
}

function endsWithNewline(runs: TextRun[]): boolean {
  return runs[runs.length - 1]?.text.endsWith("\n") ?? false;
}
