// biome-ignore-all lint/a11y/noAutofocus: focus attendu — l'édition démarre sur place, comme dans un vrai outil.
import { Button, cn } from "@workspace/ui";
import { type KeyboardEvent, useState } from "react";
import {
  BLOCKS_LIMITS,
  blockLabel,
  renderBlock,
  type SiteBlock,
  type SiteBlockKind,
} from "../blocks.ts";
import { BlockGlyph } from "./block-icon.tsx";

export type BlocksCanvasProps = {
  blocks: SiteBlock[];
  /** Identifiant du bloc sélectionné. */
  selectedId: string | null;
  /** Bloc dont le texte est modifié en place, `null` sinon. */
  editingId: string | null;
  canEdit: boolean;
  /** `null` désélectionne (Échap sur le bloc sélectionné). */
  onSelect: (id: string | null) => void;
  /**
   * Entre en édition en place (2-clic, Entrée, frappe directe) ; `seed` est le
   * premier caractère frappé, ajouté au texte existant. Pour un bloc sans
   * texte (image, bouton, colonnes), l'éditeur ouvre ses propriétés.
   */
  onStartEdit: (id: string, seed?: string) => void;
  /** Frappe dans l'éditeur en place. */
  onTextChange: (id: string, text: string) => void;
  /** Sort de l'édition en place (Entrée, Échap, perte du focus). */
  onEndEdit: () => void;
  /** Déplace le bloc sélectionné d'un cran (Alt + ↑/↓). */
  onMove: (id: string, direction: "up" | "down") => void;
  onRemove: (id: string) => void;
};

/**
 * Canevas d'édition (TASK-002) : rend chaque bloc, permet de le
 * **sélectionner** (souris ou clavier) et de le **modifier en place**
 * (2-clic, Entrée ou frappe directe sur un titre ou un texte). Les actions de
 * structure (déplacer, supprimer, propriétés) vivent dans la barre d'outils,
 * pas sur le bloc.
 *
 * Accessibilité : chaque bloc est une entrée de liste et la sélection passe
 * par un bouton qui le recouvre — une seule cible de tabulation par bloc,
 * jamais de `<button>` qui engloberait du contenu non interactif. Les
 * raccourcis `Alt` + `↑`/`↓` déplacent le bloc sélectionné et sont annoncés
 * par `aria-keyshortcuts` ; Échap désélectionne, Suppr supprime, Entrée
 * modifie en place.
 */
export function BlocksCanvas({
  blocks,
  selectedId,
  editingId,
  canEdit,
  onSelect,
  onStartEdit,
  onTextChange,
  onEndEdit,
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
      {blocks.map((block) => {
        const label = blockLabel(block.kind);
        const selected = block.id === selectedId;
        const editing = block.id === editingId;
        return (
          <li
            key={block.id}
            className="relative"
            data-block-kind={block.kind}
            data-selected={selected || undefined}
          >
            {editing ? (
              <BlockInlineEditor block={block} onTextChange={onTextChange} onEndEdit={onEndEdit} />
            ) : (
              <>
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
                  className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onSelect(block.id)}
                  onDoubleClick={() => onStartEdit(block.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onSelect(null);
                      return;
                    }
                    if (!canEdit || !selected) return;
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onStartEdit(block.id);
                      return;
                    }
                    if (event.key === "Delete" || event.key === "Backspace") {
                      event.preventDefault();
                      onRemove(block.id);
                      return;
                    }
                    // Frappe directe : une lettre sur un bloc sélectionné ouvre
                    // l'édition en place et commence le mot.
                    if (
                      event.key.length === 1 &&
                      event.key !== " " &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.altKey
                    ) {
                      event.preventDefault();
                      onStartEdit(block.id, event.key);
                    }
                  }}
                />
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Édition en place du contenu d'un bloc titre ou texte. */
function BlockInlineEditor({
  block,
  onTextChange,
  onEndEdit,
}: {
  block: SiteBlock;
  onTextChange: (id: string, text: string) => void;
  onEndEdit: () => void;
}) {
  const fieldClass =
    "w-full border-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground";
  const frameClass =
    "rounded-xl border border-primary bg-card p-4 ring-2 ring-ring ring-offset-1 ring-offset-background";

  if (block.kind === "heading") {
    return (
      <div className={frameClass}>
        <input
          aria-label="Texte du titre"
          value={block.text}
          maxLength={BLOCKS_LIMITS.heading}
          autoFocus
          onChange={(event) => onTextChange(block.id, event.target.value)}
          onBlur={onEndEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              onEndEdit();
            }
          }}
          className={cn(fieldClass, "font-display text-2xl font-semibold tracking-tight")}
        />
      </div>
    );
  }

  if (block.kind === "text") {
    return (
      <div className={frameClass}>
        <textarea
          aria-label="Texte"
          value={block.text}
          maxLength={BLOCKS_LIMITS.text}
          rows={Math.min(12, Math.max(2, block.text.split("\n").length))}
          autoFocus
          onChange={(event) => onTextChange(block.id, event.target.value)}
          onBlur={onEndEdit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onEndEdit();
            }
          }}
          className={cn(fieldClass, "min-h-16 resize-y text-sm leading-relaxed")}
        />
      </div>
    );
  }

  return null;
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
        Ajoutez un bloc depuis le menu « Insérer » : titre, texte, image, bouton ou colonnes.
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
