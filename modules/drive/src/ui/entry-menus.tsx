import {
  Button,
  DOCS_MIME,
  FileIcon,
  FORMS_MIME,
  IconChevronDown,
  IconFolder,
  IconTrash,
  SHEETS_MIME,
  SLIDES_MIME,
} from "@workspace/ui";
import { useEffect, useState } from "react";
import type { DriveEntryView } from "../server.ts";

/**
 * Menus liés à une entrée : le menu « Nouveau » de la barre d'outils et le menu
 * contextuel « ⋮ » de chaque ligne. Sortis du navigateur pour garder le
 * composant principal à la taille de sa responsabilité.
 */

/** Ferme un menu ouvert lorsque l'utilisateur appuie sur Échap. */
function useEscapeToClose(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);
}

/** Menu « Nouveau » : dossier, document ou téléversement. */
export function NewMenu({
  onFolder,
  onDoc,
  onSheet,
  onSlide,
  onForm,
  onUpload,
  uploading,
}: {
  onFolder: () => void;
  onDoc?: () => void;
  onSheet?: () => void;
  onSlide?: () => void;
  onForm?: () => void;
  onUpload: () => void;
  uploading: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEscapeToClose(open, () => setOpen(false));

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="relative">
      <Button
        size="sm"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        loading={uploading}
      >
        Nouveau <IconChevronDown className="size-3.5" />
      </Button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Fermer le menu"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-border bg-card p-1 shadow-lift"
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => choose(onFolder)}
            >
              <IconFolder /> Nouveau dossier
            </button>
            {onDoc ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => choose(onDoc)}
              >
                <FileIcon kind="file" mimeType={DOCS_MIME} name="doc" /> Nouveau document
              </button>
            ) : null}
            {onSheet ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => choose(onSheet)}
              >
                <FileIcon kind="file" mimeType={SHEETS_MIME} name="sheet" /> Nouvelle feuille de
                calcul
              </button>
            ) : null}
            {onSlide ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => choose(onSlide)}
              >
                <FileIcon kind="file" mimeType={SLIDES_MIME} name="slide" /> Nouvelle présentation
              </button>
            ) : null}
            {onForm ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => choose(onForm)}
              >
                <FileIcon kind="file" mimeType={FORMS_MIME} name="form" /> Nouveau formulaire
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => choose(onUpload)}
            >
              Téléverser un fichier
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Menu contextuel « ⋮ » d'une ligne. Le menu est positionné en `fixed` d'après le
 * rectangle du bouton : il échappe ainsi au conteneur `overflow-x-auto` du tableau
 * qui le rognait pour les dernières lignes.
 */
export function RowMenu({
  entry,
  showDownload,
  onOpen,
  onRename,
  onShare,
  onTrash,
}: {
  entry: DriveEntryView;
  showDownload: boolean;
  onOpen: () => void;
  onRename: () => void;
  onShare: () => void;
  onTrash: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  useEscapeToClose(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    // Menu ancré à l'écran : on le referme au défilement/redimensionnement
    // plutôt que de le laisser se désaligner du bouton.
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  /** Ouvre/ferme le menu sous le bouton, en le maintenant dans la fenêtre. */
  function toggleMenu(rect: DOMRect) {
    if (open) {
      setOpen(false);
      return;
    }
    const width = 208; // w-52
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    setMenuPos({
      top: rect.bottom + 4,
      left: Math.min(Math.max(rect.right - width, margin), maxLeft),
    });
    setOpen(true);
  }

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="relative inline-block text-left">
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions pour « ${entry.name} »`}
        title="Actions"
        onClick={(event) => {
          // Le bouton vit dans une ligne cliquable : sans cet arrêt de la
          // propagation, ouvrir le menu sélectionnerait aussi la ligne.
          event.stopPropagation();
          toggleMenu(event.currentTarget.getBoundingClientRect());
        }}
      >
        ⋮
      </Button>
      {open && menuPos ? (
        <>
          <button
            type="button"
            aria-label="Fermer le menu"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            style={{ top: menuPos.top, left: menuPos.left }}
            className="fixed z-30 w-52 rounded-md border border-border bg-card p-1 text-left shadow-lift"
          >
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => choose(onOpen)}
            >
              Ouvrir
            </button>
            {showDownload ? (
              <a
                role="menuitem"
                href={`/api/drive/download/${entry.id}`}
                download
                className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                Télécharger
              </a>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => choose(onRename)}
            >
              Renommer
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => choose(onShare)}
            >
              Partager
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-muted"
              onClick={() => choose(onTrash)}
            >
              <IconTrash /> Mettre à la corbeille
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
