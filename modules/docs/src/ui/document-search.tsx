import type { Editor } from "@tiptap/react";
import { Button, cn, IconClose, IconSearch, Input } from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampMatchIndex,
  formatMatchCounter,
  formatNoMatch,
  formatReplaced,
  nextMatchIndex,
  type SearchMatch,
} from "../search-text.ts";
import { EMPTY_SEARCH, matchesIn, replaceMatches, setSearch } from "./search-plugin.ts";

export type DocumentSearchProps = {
  /** Éditeur dans lequel chercher et surligner. */
  editor: Editor;
  /** Barre ouverte ou fermée. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ligne « Remplacer par » affichée (Ctrl+H, Édition › Rechercher et remplacer). */
  replaceOpen?: boolean;
  onReplaceOpenChange?: (open: boolean) => void;
  /** Remplacement autorisé (droit d'écriture). */
  canEdit?: boolean;
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
export function DocumentSearch({
  editor,
  open,
  onOpenChange,
  replaceOpen = false,
  onReplaceOpenChange,
  canEdit = false,
}: DocumentSearchProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [replacedCount, setReplacedCount] = useState<number | null>(null);
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
    setReplacement("");
    setReplacedCount(null);
    setActiveIndex(0);
    setSearch(editor, EMPTY_SEARCH);
  }, [open, editor]);

  // Publication de la recherche : une méta de transaction, jamais une écriture.
  useEffect(() => {
    if (!open) return;
    setSearch(editor, { query, activeIndex: active, caseSensitive });
  }, [open, editor, query, active, caseSensitive]);

  // Occurrences affichées : recalculées à la requête, puis à chaque changement
  // de document (frappe locale comme collaborateur distant).
  useEffect(() => {
    if (!open) return;
    setMatches(matchesIn(editor, query, caseSensitive));
    const sync = () => setMatches(matchesIn(editor, query, caseSensitive));
    editor.on("update", sync);
    return () => {
      editor.off("update", sync);
    };
  }, [open, editor, query, caseSensitive]);

  /** Remplace l'occurrence active, puis passe à la suivante (comme Word). */
  const replaceCurrent = useCallback(() => {
    const match = matches[active];
    if (!canEdit || !match) return;
    replaceMatches(editor, [match], replacement);
    setReplacedCount(1);
  }, [active, canEdit, editor, matches, replacement]);

  /** Remplace toutes les occurrences en une seule étape d'annulation. */
  const replaceAll = useCallback(() => {
    if (!canEdit || matches.length === 0) return;
    setReplacedCount(replaceMatches(editor, matches, replacement));
    setActiveIndex(0);
  }, [canEdit, editor, matches, replacement]);

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
        {replacedCount !== null && matches.length === 0
          ? formatReplaced(replacedCount)
          : hasQuery && matches.length === 0
            ? formatNoMatch(query)
            : formatMatchCounter(active, matches.length)}
      </span>

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(event) => setCaseSensitive(event.target.checked)}
          className="size-3.5 accent-[var(--primary)]"
        />
        Respecter la casse
      </label>

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
        {canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={replaceOpen}
            onClick={() => onReplaceOpenChange?.(!replaceOpen)}
          >
            Remplacer…
          </Button>
        ) : null}
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

      {replaceOpen && canEdit ? (
        <div className="flex w-full flex-wrap items-center gap-2 pl-6">
          <Input
            type="text"
            value={replacement}
            onChange={(event) => {
              setReplacement(event.target.value);
              setReplacedCount(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.ctrlKey || event.metaKey) replaceAll();
                else replaceCurrent();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onOpenChange(false);
              }
            }}
            aria-label="Remplacer par"
            placeholder="Remplacer par…"
            autoComplete="off"
            className="h-8 w-56"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={matches.length === 0}
            onClick={replaceCurrent}
          >
            Remplacer
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={matches.length === 0}
            onClick={replaceAll}
          >
            Tout remplacer
          </Button>
        </div>
      ) : null}
    </search>
  );
}
