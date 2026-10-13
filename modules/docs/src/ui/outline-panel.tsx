import type { Editor } from "@tiptap/react";
import { Button, cn, EmptyState, IconClose } from "@workspace/ui";
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";
import {
  activeFromTops,
  activeHeadingIndex,
  headingLevel,
  type OutlineHeading,
  outlineIndentClass,
  outlineLabel,
  outlineTitle,
  sameOutline,
  stepHeadingIndex,
} from "../outline.ts";
import { OutlineIcon } from "./icons.tsx";

export type OutlinePanelProps = {
  editor: Editor;
  /** Zone de défilement du document : repère de la position courante. */
  scrollElement: HTMLElement | null;
  /** Lecture seule : on navigue sans déplacer de curseur d'écriture. */
  canEdit: boolean;
  onClose: () => void;
};

/** Sélecteur des titres rendus par l'éditeur, dans l'ordre du document. */
const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/** Hauteur sous laquelle un titre compte comme lu, en pixels. */
const ACTIVE_OFFSET_PX = 96;

/** Titres rendus par l'éditeur, dans l'ordre du document. */
function headingElements(editor: Editor): Element[] {
  return Array.from(editor.view.dom.querySelectorAll(HEADING_SELECTOR));
}

/**
 * Panneau « Plan » : la liste des titres du document.
 *
 * - cliquer une entrée y place le curseur (ou fait défiler, en lecture seule) ;
 * - `↑` / `↓` se déplacent dans la liste, `Début` / `Fin` vont aux extrémités ;
 * - l'entrée lue est marquée `aria-current="location"` et suit le curseur comme
 *   le défilement ;
 * - un document sans titre affiche un état vide explicite.
 */
export function OutlinePanel({ editor, scrollElement, canEdit, onClose }: OutlinePanelProps) {
  const [headings, setHeadings] = useState<readonly OutlineHeading[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Les titres sont relus à chaque changement de document (ajout, renommage,
  // suppression) ; `sameOutline` évite une reconstruction à chaque frappe.
  useEffect(() => {
    const collect = () => {
      const next: OutlineHeading[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "heading") return true;
        next.push({
          level: headingLevel(node.attrs.level),
          text: outlineTitle(node.textContent),
          pos,
        });
        return true;
      });
      setHeadings((current) => (sameOutline(current, next) ? current : next));
    };

    collect();
    editor.on("update", collect);
    return () => {
      editor.off("update", collect);
    };
  }, [editor]);

  // Position courante : le curseur désigne la section qui le précède.
  useEffect(() => {
    const sync = () => {
      setActiveIndex(activeHeadingIndex(headings, editor.state.selection.from));
    };
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("update", sync);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("update", sync);
    };
  }, [editor, headings]);

  // Position courante : le défilement a le dernier mot (lecture sans curseur).
  useEffect(() => {
    const element = scrollElement;
    if (!element) return;

    let frame = 0;
    const sync = () => {
      frame = 0;
      const elements = headingElements(editor);
      if (elements.length !== headings.length) return;
      setActiveIndex(
        activeFromTops(
          elements.map((node) => node.getBoundingClientRect().top),
          ACTIVE_OFFSET_PX,
        ),
      );
    };

    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(sync);
    };

    sync();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [editor, scrollElement, headings]);

  const navigate = useCallback(
    (heading: OutlineHeading, index: number) => {
      const element = headingElements(editor)[index];
      if (canEdit) {
        // `focus` place le curseur sans défilement propre : c'est notre
        // défilement suivant qui amène le titre en haut de page.
        editor.commands.focus(heading.pos, { scrollIntoView: false });
      }
      element?.scrollIntoView({ block: "start", behavior: "smooth" });
      setActiveIndex(index);
    },
    [canEdit, editor],
  );

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button"));
    if (buttons.length === 0) return;

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
      return;
    }

    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (delta === 0) return;

    const current = event.target instanceof HTMLButtonElement ? buttons.indexOf(event.target) : -1;
    const next = stepHeadingIndex(current, delta, buttons.length);
    if (next < 0 || next === current) return;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return (
    <aside
      aria-label="Plan du document"
      className="print-hide flex w-60 shrink-0 flex-col border-r border-border bg-card"
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <OutlineIcon />
          Plan
        </p>
        <Button variant="ghost" size="sm" aria-label="Fermer le plan" onClick={onClose}>
          <IconClose />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {headings.length === 0 ? (
          <EmptyState
            icon={<OutlineIcon />}
            title="Aucun titre"
            hint="Les titres de niveau 1 à 3 (boutons H1, H2, H3) apparaîtront ici et permettront de naviguer dans le document."
            className="p-4 text-left"
          />
        ) : (
          <ul className="space-y-0.5" onKeyDown={onListKeyDown}>
            {headings.map((heading, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: l'index est le seul identifiant stable ici — la position, elle, change à chaque frappe dans le document.
              <li key={index}>
                <button
                  type="button"
                  title={heading.text || undefined}
                  className={cn(
                    "w-full rounded-md px-2 py-1 text-left text-sm hover:bg-muted",
                    index === activeIndex && "bg-accent font-medium text-accent-foreground",
                  )}
                  aria-current={index === activeIndex ? "location" : undefined}
                  onClick={() => navigate(heading, index)}
                >
                  {/* Niveau annoncé : un plan muet ne dit pas où l'on va. */}
                  <span className="sr-only">{`Titre de niveau ${heading.level} : `}</span>
                  <span className={cn("block truncate", outlineIndentClass(heading.level))}>
                    {outlineLabel(heading.text)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
