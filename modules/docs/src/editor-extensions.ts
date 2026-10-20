import { type CommandProps, Extension, Mark, mergeAttributes, Node } from "@tiptap/core";
import { normalizePageSetup, type PageSetup } from "./page-setup.ts";

/**
 * Extensions « traitement de texte » de l'éditeur Docs (v3) :
 *
 * - `PagedDocument` : nœud racine qui porte la mise en page (`pageSetup`) ;
 * - `ParagraphFormat` : interligne et retrait par paragraphe / titre ;
 * - `Superscript` / `Subscript` : exposant et indice (exclusifs l'un de l'autre) ;
 * - `WordShortcuts` : raccourcis de Word / Google Docs absents de StarterKit.
 *
 * Toutes ces données vivent dans le JSON ProseMirror déjà persisté : aucune
 * migration, et un document ancien s'ouvre à l'identique.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphFormat: {
      /** Interligne (« 1.15 », « 1.5 »…) ; `null` revient au défaut. */
      setLineHeight: (value: string | null) => ReturnType;
      /** Augmente le retrait des blocs sélectionnés (hors listes : les listes s'imbriquent). */
      indent: () => ReturnType;
      /** Diminue le retrait des blocs sélectionnés. */
      outdent: () => ReturnType;
    };
    pagedDocument: {
      /** Remplace la mise en page du document. */
      setPageSetup: (setup: PageSetup) => ReturnType;
    };
    superscript: {
      toggleSuperscript: () => ReturnType;
    };
    subscript: {
      toggleSubscript: () => ReturnType;
    };
  }
}

/** Interlignes proposés (valeur CSS sans unité, libellé français). */
export const LINE_HEIGHTS: readonly { value: string; label: string }[] = [
  { value: "1", label: "Simple" },
  { value: "1.15", label: "1,15" },
  { value: "1.5", label: "1,5" },
  { value: "2", label: "Double" },
];

/** Retrait maximal (paliers de 1,25 cm, comme la touche Tab de Word). */
export const MAX_INDENT = 8;
/** Largeur d'un palier de retrait, en em (≈ 1,25 cm à 11 pt). */
export const INDENT_STEP_EM = 2.5;

const INDENTABLE = ["paragraph", "heading"] as const;

/** Interligne relu d'un attribut de style : seules les valeurs du catalogue passent. */
export function normalizeLineHeight(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return LINE_HEIGHTS.some((option) => option.value === text) ? text : null;
}

/** Retrait relu d'un attribut (entier borné, 0 = aucun). */
export function normalizeIndent(value: unknown): number {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(MAX_INDENT, Math.round(number)));
}

export const PagedDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "block+",

  addAttributes() {
    return {
      pageSetup: { default: null },
    };
  },

  addCommands() {
    return {
      setPageSetup:
        (setup: PageSetup) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setDocAttribute("pageSetup", normalizePageSetup(setup));
          return true;
        },
    };
  },
});

export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",

  addGlobalAttributes() {
    return [
      {
        types: [...INDENTABLE],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => normalizeLineHeight(element.style.lineHeight),
            renderHTML: (attributes) => {
              const value = normalizeLineHeight(attributes.lineHeight);
              return value ? { style: `line-height: ${value}` } : {};
            },
          },
          indent: {
            default: 0,
            parseHTML: (element) => {
              const fromData = element.getAttribute("data-indent");
              if (fromData) return normalizeIndent(fromData);
              // Collage depuis Word / Google Docs : marge gauche en pt ou px.
              const margin = Number.parseFloat(element.style.marginLeft || "");
              if (!Number.isFinite(margin) || margin <= 0) return 0;
              const px = element.style.marginLeft.endsWith("pt") ? margin * (96 / 72) : margin;
              return normalizeIndent(px / 48);
            },
            renderHTML: (attributes) => {
              const indent = normalizeIndent(attributes.indent);
              return indent > 0
                ? {
                    "data-indent": String(indent),
                    style: `margin-left: ${indent * INDENT_STEP_EM}em`,
                  }
                : {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const shift =
      (delta: 1 | -1) =>
      () =>
      ({ tr, state }: CommandProps) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!(INDENTABLE as readonly string[]).includes(node.type.name)) return true;
          const current = normalizeIndent(node.attrs.indent);
          const next = Math.max(0, Math.min(MAX_INDENT, current + delta));
          if (next !== current) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            changed = true;
          }
          return false;
        });
        return changed;
      };

    return {
      setLineHeight:
        (value: string | null) =>
        ({ tr, state }) => {
          const normalized = value === null ? null : normalizeLineHeight(value);
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!(INDENTABLE as readonly string[]).includes(node.type.name)) return true;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineHeight: normalized });
            return false;
          });
          return true;
        },
      indent: shift(1),
      outdent: shift(-1),
    };
  },
});

export const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",

  parseHTML() {
    return [
      { tag: "sup" },
      { style: "vertical-align", getAttrs: (value) => (value === "super" ? null : false) },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleSuperscript:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-.": () => this.editor.commands.toggleSuperscript() };
  },
});

export const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",

  parseHTML() {
    return [
      { tag: "sub" },
      { style: "vertical-align", getAttrs: (value) => (value === "sub" ? null : false) },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sub", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleSubscript:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-,": () => this.editor.commands.toggleSubscript() };
  },
});

/**
 * Raccourcis Word / Google Docs absents des extensions de base :
 * Ctrl+\ efface la mise en forme, Ctrl+] / Ctrl+[ règlent le retrait,
 * Ctrl+Alt+0 revient au style Normal.
 * (Ctrl+Alt+1…3 titres, Ctrl+Maj+7/8/9 listes et Ctrl+Maj+L/E/R/J
 * alignements sont déjà fournis par StarterKit, TaskList et TextAlign.)
 */
export const WordShortcuts = Extension.create({
  name: "wordShortcuts",

  addKeyboardShortcuts() {
    return {
      "Mod-\\": () => this.editor.chain().focus().unsetAllMarks().run(),
      "Mod-]": () => this.editor.commands.indent(),
      "Mod-[": () => this.editor.commands.outdent(),
      "Mod-Alt-0": () => this.editor.commands.setParagraph(),
    };
  },
});
