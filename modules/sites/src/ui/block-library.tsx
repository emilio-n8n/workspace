import { Button } from "@workspace/ui";
import { BLOCK_LIBRARY, type SiteBlockKind } from "../blocks.ts";
import { BlockGlyph } from "./block-icon.tsx";

export type BlockLibraryProps = {
  /** Droit d'édition de la page : sans lui, la bibliothèque est désactivée. */
  canEdit: boolean;
  /** Bloc après lequel insérer ; `null` = fin de page. */
  afterId: string | null;
  onAdd: (kind: SiteBlockKind) => void;
};

/**
 * Bibliothèque de blocs (TASK-001) : les cinq blocs disponibles — titre,
 * texte, image, bouton, colonnes. Chaque entrée est un vrai bouton, dans
 * l'ordre de tabulation, décrit par son intitulé et sa description ; le bloc
 * est inséré après la sélection courante pour ne pas perdre le contexte.
 */
export function BlockLibrary({ canEdit, afterId, onAdd }: BlockLibraryProps) {
  return (
    <section aria-labelledby="block-library-title" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="block-library-title"
          className="text-xs font-medium uppercase tracking-widest text-muted-foreground"
        >
          Bibliothèque de blocs
        </h2>
        <p className="text-xs text-muted-foreground">
          {afterId ? "Ajout après le bloc sélectionné" : "Ajout en fin de page"}
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {BLOCK_LIBRARY.map((definition) => (
          <li key={definition.kind}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canEdit}
              onClick={() => onAdd(definition.kind)}
              aria-describedby={`block-library-${definition.kind}-hint`}
              className="h-auto justify-start gap-2 py-2 text-left"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <BlockGlyph kind={definition.kind} />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{definition.label}</span>
                <span
                  id={`block-library-${definition.kind}-hint`}
                  className="text-xs font-normal text-muted-foreground"
                >
                  {definition.description}
                </span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
