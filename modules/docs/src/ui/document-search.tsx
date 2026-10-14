import type { Editor } from "@tiptap/react";
import { Button, cn, IconClose, IconSearch, Input } from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampMatchIndex,
  formatMatchCounter,
  formatNoMatch,
  nextMatchIndex,
  type SearchMatch,
} from "../search-text.ts";
import { EMPTY_SEARCH, matchesIn, setSearch } from "./search-plugin.ts";

export type DocumentSearchProps = {
  /** Éditeur dans lequel chercher et surligner. */
  editor: Editor;
  /** Barre ouverte ou fermée. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Barre de recherche du document.
 *
 * - champ de saisie, compteur d'occurrences (« Occurrence 2 sur 5 ») :
 *   le compteur est une région live — il est annoncé à chaque déplacement ;
 * - `Entrée` / `Maj+Entrée`, ou les boutons, pour passer à l'occurrence suivante
 *   ou précédente en bouclant ;
 * - `Échap` ferme la barre et efface les surlignages ;
 * - compteur et surlignages viennent de la même fonction (`findMatches`) : ce
 *   qui est affiché est exactement ce qui est surligné.
 *
 * Les occurrences sont recalculées quand le document change : un collaborateur
 * qui tape fait apparaître ou disparaître des résultats.
 */
export function DocumentSearch({ editor, open, onOpenChange }: DocumentSearchProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [matches, setMatches] = useState<readonly SearchMatch[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Index actif, ramené dans les bornes (un document qui rétrécit). */
  const active = clampMatchIndex(activeIndex, matches.length);
  const hasQuery = query.trim().length > 0;

  // Ouverture : le focus va au champ. Fermeture : on oublie tout, on efface.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    setQuery("");
    setActiveIndex(0);
    setSearch(editor, EMPTY_SEARCH);
  }, [open, editor]);

  // Publication de la recherche : une méta de transaction, jamais une écriture.
  useEffect(() => {
    if (!open) return;
    setSearch(editor, { query, activeIndex: active });
  }, [open, editor, query, active]);

  // Occurrences affichées : recalculées à la requête, puis à chaque changement
  // de document (frappe locale comme collaborateur distant).
  useEffect(() => {
    if (!open) return;
    setMatches(matchesIn(editor, query));
    const sync = () => setMatches(matchesIn(editor, query));
    editor.on("update", sync);
    return () => {
      editor.off("update", sync);
    };
  }, [open, editor, query]);

  const goto = useCallback(
    (step: number) => {
      if (matches.length === 0) return;
      const next = nextMatchIndex(active, matches.length, step);
      setActiveIndex(next);
      const match = matches[next];
      if (!match) return;
      // Placer la sélection fait défiler jusqu'à l'occurrence et garde le
      // panneau « Plan » en phase. Aucune écriture : ces commandes ne sont pas
      // gardées par `editable`, la navigation marche donc aussi en lecture seule.
      editor.chain().setTextSelection(match).scrollIntoView().run();
    },
    [active, editor, matches],
  );

  if (!open) return null;

  return (
    <search
      aria-label="Recherche dans le document"
      className="print-hide flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
    >
      <IconSearch aria-hidden className="size-4 shrink-0 text-muted-foreground" />

      <Input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          // Nouvelle requête : on repart de la première occurrence.
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            goto(event.shiftKey ? -1 : 1);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onOpenChange(false);
          }
        }}
        aria-label="Texte à rechercher"
        placeholder="Rechercher dans le document…"
        autoComplete="off"
        className="h-8 w-56"
      />

      <span
        role="status"
        className={cn(
          "text-xs",
          hasQuery && matches.length === 0 ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {hasQuery && matches.length === 0
          ? formatNoMatch(query)
          : formatMatchCounter(active, matches.length)}
      </span>

      <div className="ml-auto flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Occurrence précédente"
          disabled={matches.length === 0}
          onClick={() => goto(-1)}
        >
          ↑
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Occurrence suivante"
          disabled={matches.length === 0}
          onClick={() => goto(1)}
        >
          ↓
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Fermer la recherche"
          onClick={() => onOpenChange(false)}
        >
          <IconClose />
        </Button>
      </div>
    </search>
  );
}
