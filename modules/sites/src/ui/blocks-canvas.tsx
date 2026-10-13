import { Button, cn, IconChevronDown, IconTrash } from "@workspace/ui";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { blockLabel, renderBlock, type SiteBlock, type SiteBlockKind } from "../blocks.ts";
import { BlockGlyph } from "./block-icon.tsx";

export type BlocksCanvasProps = {
  blocks: SiteBlock[];
  /** Identifiant du bloc sélectionné. */
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  /** Déplace un bloc d'un cran (monter / descendre). */
  onMove: (id: string, direction: "up" | "down") => void;
  onRemove: (id: string) => void;
};

/**
 * Canevas d'édition (TASK-002) : rend chaque bloc, permet de le
 * **sélectionner** (souris ou clavier) et de le **déplacer** vers le haut ou
 * le bas.
 *
 * Accessibilité : chaque bloc est une entrée de liste et la sélection passe
 * par un bouton qui le recouvre — une seule cible de tabulation par bloc,
 * jamais de `<button>` qui engloberait du contenu non interactif. Les
 * raccourcis `Alt` + `↑`/`↓` déplacent le bloc sélectionné et sont annoncés
 * par `aria-keyshortcuts`. Les bordures de liste désactivent les commandes
 * impossibles plutôt que de les masquer.
 */
export function BlocksCanvas({
  blocks,
  selectedId,
  canEdit,
  onSelect,
  onMove,
  onRemove,
}: BlocksCanvasProps) {
  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (!canEdit || !selectedId || !event.altKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onMove(selectedId, event.key === "ArrowUp" ? "up" : "down");
  }

  return (
    <ul
      aria-label="Blocs de la page"
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2"
    >
      {blocks.map((block, index) => {
        const label = blockLabel(block.kind);
        const selected = block.id === selectedId;
        return (
          // `group` pilote l'apparition de la barre d'outils au survol et au
          // focus clavier ; le bloc sélectionné la garde toujours visible.
          <li
            key={block.id}
            className="group relative"
            data-block-kind={block.kind}
            data-selected={selected || undefined}
          >
            <div
              className={cn(
                "rounded-xl border bg-card p-4 transition-colors",
                selected
                  ? "border-primary ring-2 ring-ring ring-offset-1 ring-offset-background"
                  : "border-border",
              )}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML produit par `renderBlock` (échappement systématique, URL assainies).
              dangerouslySetInnerHTML={{ __html: renderBlock(block) }}
            />
            <button
              type="button"
              aria-pressed={selected}
              aria-label={`${label} — sélectionner le bloc`}
              className="absolute inset-0 rounded-xl focus-visible:outline-none"
              onClick={() => onSelect(block.id)}
            />
            <div
              className={cn(
                "absolute right-2 top-2 flex gap-1 rounded-lg border border-border bg-popover/95 p-1 shadow-soft transition-opacity",
                canEdit
                  ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                  : "hidden",
                selected && "opacity-100",
              )}
            >
              <ToolbarAction
                label={`Monter le bloc ${label}`}
                disabled={!canEdit || index === 0}
                onClick={() => onMove(block.id, "up")}
              >
                <IconChevronDown className="rotate-180" />
              </ToolbarAction>
              <ToolbarAction
                label={`Descendre le bloc ${label}`}
                disabled={!canEdit || index === blocks.length - 1}
                onClick={() => onMove(block.id, "down")}
              >
                <IconChevronDown />
              </ToolbarAction>
              <ToolbarAction
                label={`Supprimer le bloc ${label}`}
                disabled={!canEdit}
                destructive
                onClick={() => onRemove(block.id)}
              >
                <IconTrash />
              </ToolbarAction>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ToolbarAction({
  label,
  destructive = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "size-7 justify-center p-0",
        destructive && "text-destructive hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      {children}
    </Button>
  );
}

/**
 * État vide du constructeur : la page n'a aucun bloc. L'action proposée ajoute
 * un titre, point d'entrée le plus courant d'une page.
 */
export function BlocksEmptyState({
  canEdit,
  onAdd,
}: {
  canEdit: boolean;
  onAdd: (kind: SiteBlockKind) => void;
}) {
  const [added, setAdded] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-10 text-center">
      <span className="text-muted-foreground">
        <BlockGlyph kind="heading" className="size-6" />
      </span>
      <p className="font-medium">Page vide</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Ajoutez un bloc depuis la bibliothèque ci-dessus : titre, texte, image, bouton ou colonnes.
      </p>
      {canEdit ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onAdd("heading");
            setAdded(true);
          }}
        >
          Ajouter un titre
        </Button>
      ) : null}
      <p className="sr-only" role="status">
        {added ? "Titre ajouté à la page" : ""}
      </p>
    </div>
  );
}
