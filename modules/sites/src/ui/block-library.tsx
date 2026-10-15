import { Menu } from "@workspace/ui";
import { BLOCK_LIBRARY, type SiteBlockKind } from "../blocks.ts";
import { BlockGlyph } from "./block-icon.tsx";

export type BlockLibraryProps = {
  /** Droit d'édition de la page : sans lui, la bibliothèque est désactivée. */
  canEdit: boolean;
  /** La page a atteint le nombre maximal de blocs. */
  full?: boolean;
  onAdd: (kind: SiteBlockKind) => void;
};

/**
 * Bibliothèque de blocs (TASK-001) : un menu « Insérer » compact, dans la
 * barre d'outils — les cinq blocs disponibles sont titre, texte, image,
 * bouton et colonnes. Le bloc est inséré après la sélection courante pour ne
 * pas perdre le contexte.
 */
export function BlockLibrary({ canEdit, full = false, onAdd }: BlockLibraryProps) {
  return (
    <Menu
      label="Insérer"
      align="start"
      triggerClassName="h-8 border-transparent bg-transparent px-2 text-sm font-medium hover:bg-muted focus-visible:ring-offset-0"
      items={BLOCK_LIBRARY.map((definition) => ({
        id: definition.kind,
        label: definition.label,
        icon: <BlockGlyph kind={definition.kind} />,
        disabled: !canEdit || full,
        onSelect: () => onAdd(definition.kind),
      }))}
    />
  );
}
