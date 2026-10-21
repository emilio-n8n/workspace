import { cn } from "@workspace/ui";
import { type CSSProperties, useEffect, useRef } from "react";
import type { EditorElement } from "../editor-model.ts";
import { MAX_ELEMENT_TEXT } from "../slide-paste.ts";
import {
  displayRuns,
  normalizeRuns,
  type RichNode,
  type RunBase,
  runsText,
  runsToHtml,
  type TextRun,
  treeToRuns,
} from "../slide-rich-text.ts";
import {
  SLIDE_TEXT_COLOR_IDS,
  SLIDE_TEXT_COLORS,
  type SlideTextColor,
  textColorClass,
  textColorLabel,
} from "../slide-text.ts";

/**
 * Couleurs sentinelles passées à `execCommand("foreColor")` : le navigateur
 * découpe proprement la sélection, puis chaque `<font color>` est remplacé
 * par un `span[data-color]` portant le **jeton** (jamais une couleur en dur).
 */
const SENTINELS: Record<SlideTextColor, string> = {
  default: "#000001",
  muted: "#000002",
  accent: "#000003",
  attention: "#000004",
  danger: "#000005",
};
const SENTINEL_TO_COLOR = new Map(
  Object.entries(SENTINELS).map(([color, hex]) => [hex, color as SlideTextColor] as const),
);

function weightOf(value: string): boolean | undefined {
  if (!value) return undefined;
  if (value === "bold" || value === "bolder") return true;
  const number = Number(value);
  if (Number.isFinite(number)) return number >= 600;
  return value === "normal" || value === "lighter" ? false : undefined;
}

/** Lecture du DOM de l'éditeur vers l'arbre neutre de `slide-rich-text`. */
export function domToTree(root: Node): RichNode[] {
  const nodes: RichNode[] = [];
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      nodes.push({ type: "text", text: child.textContent ?? "" });
      continue;
    }
    if (!(child instanceof HTMLElement)) continue;
    const style = child.style;
    const decoration = `${style.textDecorationLine} ${style.textDecoration}`;
    const fontColor =
      child.tagName === "FONT" ? child.getAttribute("color")?.toLowerCase() : undefined;
    const dataColor = child.dataset.color;
    nodes.push({
      type: "element",
      tag: child.tagName,
      bold: weightOf(style.fontWeight),
      italic: style.fontStyle
        ? style.fontStyle === "italic" || style.fontStyle === "oblique"
        : undefined,
      underline: decoration.includes("underline")
        ? true
        : decoration.includes("none")
          ? false
          : undefined,
      color:
        (fontColor ? SENTINEL_TO_COLOR.get(fontColor) : undefined) ??
        ((SLIDE_TEXT_COLOR_IDS as readonly string[]).includes(dataColor ?? "")
          ? (dataColor as SlideTextColor)
          : undefined),
      children: domToTree(child),
    });
  }
  return nodes;
}

export function baseOf(element: EditorElement): RunBase {
  return {
    bold: element.bold,
    italic: element.italic,
    underline: element.underline,
    textColor: element.textColor,
  };
}

type Props = {
  element: EditorElement;
  className: string;
  style: CSSProperties;
  onChange: (text: string, runs: TextRun[] | null) => void;
  onEnd: () => void;
  /** Mini-barre sous la zone (zone collée au haut de la diapositive). */
  toolbarBelow?: boolean;
};

/**
 * Édition en place d'une zone de texte avec mise en forme **par mot** :
 * Ctrl+B / Ctrl+I / Ctrl+U sur la sélection (commandes natives), mini-barre
 * flottante (gras, italique, souligné, couleurs sémantiques). Le contenu est
 * relu en segments à chaque frappe : texte brut et texte enrichi restent
 * toujours cohérents.
 */
export function RichTextEditor({
  element,
  className,
  style,
  onChange,
  onEnd,
  toolbarBelow = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const base = baseOf(element);
  const baseRef = useRef(base);
  baseRef.current = base;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Amorçage unique : le DOM est ensuite non contrôlé (le curseur ne saute pas).
  // biome-ignore lint/correctness/useExhaustiveDependencies: amorcé une fois à l'ouverture de l'édition.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerHTML = runsToHtml(displayRuns(element.text, element.runs), base, textColorClass);
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  function sync() {
    const node = ref.current;
    if (!node) return;
    // Les `<font>` sentinelles deviennent des `span[data-color]` à jeton.
    for (const font of Array.from(node.querySelectorAll("font[color]"))) {
      const color = SENTINEL_TO_COLOR.get((font.getAttribute("color") ?? "").toLowerCase());
      const span = document.createElement("span");
      if (color) {
        span.dataset.color = color;
        const tone = textColorClass(color);
        if (tone) span.className = tone;
      }
      while (font.firstChild) span.appendChild(font.firstChild);
      font.replaceWith(span);
    }
    const runs = treeToRuns(domToTree(node), baseRef.current);
    let text = runsText(runs);
    let clipped = runs;
    if (text.length > MAX_ELEMENT_TEXT) {
      let budget = MAX_ELEMENT_TEXT;
      clipped = [];
      for (const run of runs) {
        if (budget <= 0) break;
        clipped.push({ ...run, text: run.text.slice(0, budget) });
        budget -= run.text.length;
      }
      text = runsText(clipped);
    }
    onChangeRef.current(text, normalizeRuns(clipped, baseRef.current));
  }

  function command(name: "bold" | "italic" | "underline") {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(name);
    sync();
  }

  function color(token: SlideTextColor) {
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("foreColor", false, SENTINELS[token]);
    sync();
  }

  const keepFocus = (event: React.PointerEvent | React.MouseEvent) => event.preventDefault();

  return (
    <div
      className={cn(className, "z-10 outline outline-2 outline-primary")}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        role="toolbar"
        aria-label="Mise en forme du texte sélectionné"
        className={cn(
          "absolute left-0 z-30 flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 text-popover-foreground shadow-lift",
          toolbarBelow ? "-bottom-10" : "-top-10",
        )}
        style={{
          fontSize: 13,
          fontWeight: 400,
          fontStyle: "normal",
          textDecorationLine: "none",
          lineHeight: 1,
        }}
      >
        <button
          type="button"
          aria-label="Gras (sélection)"
          title="Gras (Ctrl+B)"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => command("bold")}
          className="grid size-7 place-items-center rounded font-bold hover:bg-muted"
        >
          G
        </button>
        <button
          type="button"
          aria-label="Italique (sélection)"
          title="Italique (Ctrl+I)"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => command("italic")}
          className="grid size-7 place-items-center rounded italic hover:bg-muted"
        >
          I
        </button>
        <button
          type="button"
          aria-label="Souligné (sélection)"
          title="Souligné (Ctrl+U)"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => command("underline")}
          className="grid size-7 place-items-center rounded underline hover:bg-muted"
        >
          S
        </button>
        <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
        {SLIDE_TEXT_COLOR_IDS.map((token) => (
          <button
            key={token}
            type="button"
            aria-label={`Couleur ${textColorLabel(token)} (sélection)`}
            title={textColorLabel(token)}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => color(token)}
            className="grid size-7 place-items-center rounded hover:bg-muted"
          >
            <span
              aria-hidden
              className={cn(
                "size-3.5 rounded-full border border-border",
                SLIDE_TEXT_COLORS[token].swatchClass,
              )}
            />
          </button>
        ))}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: zone de texte enrichi (contenteditable), un textarea ne porte pas de mise en forme par mot. */}
      <div
        ref={ref}
        role="textbox"
        tabIndex={0}
        aria-multiline="true"
        aria-label="Modifier le texte"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={sync}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onEnd();
          }
        }}
        onPaste={(event) => {
          // Collage en texte brut : la mise en forme vient de la zone.
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
        onBlur={() => onEnd()}
        className="size-full overflow-hidden whitespace-pre-wrap break-words outline-none"
      />
    </div>
  );
}
