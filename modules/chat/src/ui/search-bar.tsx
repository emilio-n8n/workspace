import { Button, Input, Kbd, Select } from "@workspace/ui";
import { type ChangeEvent, useEffect, useRef } from "react";
import type { SearchFilters } from "./search.ts";

export type SearchAuthor = {
  id: string;
  name: string;
};

export type SearchBarProps = {
  channelName: string;
  /** Membres du canal — alimentent le filtre par auteur. */
  authors: readonly SearchAuthor[];
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
  /** Compteur « 3 / 12 » (null quand il n'y a rien à compter). */
  counter: string | null;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
};

/**
 * Recherche dans le canal courant : texte, auteur, compteur de résultats et
 * navigation. La barre annonce son décompte en `aria-live` (les résultats
 * changent à chaque frappe) sans jamais voler le focus — tant qu'on cherche, on
 * reste dans le champ. Échap ferme et rend le focus au bouton d'ouverture.
 */
export function SearchBar({
  channelName,
  authors,
  filters,
  onFiltersChange,
  counter,
  onPrevious,
  onNext,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Ouverture : le focus va au champ, pas à la page.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function onQuery(event: ChangeEvent<HTMLInputElement>) {
    onFiltersChange({ ...filters, query: event.target.value });
  }

  const options = [
    { value: "", label: "Tous les membres" },
    ...authors.map((author) => ({ value: author.id, label: author.name })),
  ];

  return (
    <search className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <Input
        ref={inputRef}
        aria-label="Rechercher dans le canal"
        placeholder={`Rechercher dans #${channelName}…`}
        value={filters.query}
        onChange={onQuery}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === "Enter") {
            // Entrée avance dans les résultats, comme dans les éditeurs.
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          }
        }}
        className="h-8 min-w-40 flex-1 text-sm"
      />
      <div className="w-44">
        <Select
          label="Auteur"
          options={options}
          value={filters.authorId ?? ""}
          onChange={(value) =>
            onFiltersChange({ ...filters, authorId: value === "" ? null : value })
          }
          placeholder="Tous les membres"
        />
      </div>
      <span
        aria-live="polite"
        data-testid="search-counter"
        className="min-w-12 text-center text-xs text-muted-foreground"
      >
        {counter ?? "0 / 0"}
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={onPrevious}
          aria-label="Résultat précédent"
          title="Résultat précédent"
        >
          ↑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onNext}
          aria-label="Résultat suivant"
          title="Résultat suivant"
        >
          ↓
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Fermer la recherche"
          title="Fermer la recherche"
        >
          ✕
        </Button>
      </div>
      <Kbd className="ml-auto hidden sm:inline-flex">Échap</Kbd>
    </search>
  );
}
