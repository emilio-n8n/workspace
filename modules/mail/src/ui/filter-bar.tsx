import { Button, cn, Input } from "@workspace/ui";
import { useId } from "react";
import type { MailLabel } from "../server.ts";
import {
  activeFilters,
  clearFilter,
  FILTER_LABELS,
  type MailFilters,
  normalizeFilterValue,
} from "./filters.ts";

export type FilterBarProps = {
  filters: MailFilters;
  /** Nombre de messages affichés — annoncé aux lecteurs d'écran. */
  resultCount: number;
  /** Libellés disponibles, pour nommer le filtre actif. */
  labels: MailLabel[];
  onChange: (next: MailFilters) => void;
  /** Champ de recherche, ciblé par le raccourci « / ». */
  inputRef?: React.Ref<HTMLInputElement>;
};

/**
 * Barre de recherche et de filtres — une seule rangée compacte : recherche
 * plein texte, interrupteurs (non lus, suivis, pièce jointe), expéditeur et
 * destinataire. Chaque filtre actif est une puce annulable, le changement est
 * annoncé (aria-live) avec le nombre de résultats, et sur manque de place la
 * rangée défile horizontalement au lieu de casser la mise en page.
 */
export function FilterBar({ filters, resultCount, labels, onChange, inputRef }: FilterBarProps) {
  const ids = useId();
  const active = activeFilters(filters, labels.find((label) => label.id === filters.labelId)?.name);

  return (
    <>
      <div
        role="toolbar"
        aria-label="Recherche et filtres"
        className="flex h-10 shrink-0 flex-nowrap items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card px-2"
      >
        <label className="sr-only" htmlFor={`${ids}-query`}>
          {FILTER_LABELS.query}
        </label>
        <Input
          id={`${ids}-query`}
          ref={inputRef}
          value={filters.query}
          placeholder="Rechercher… (touche /)"
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          className="h-8 min-w-40 max-w-sm flex-1"
        />

        <div className="flex shrink-0 items-center gap-1">
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          <FilterToggle
            label={FILTER_LABELS.unreadOnly}
            active={filters.unreadOnly}
            onClick={() => onChange({ ...filters, unreadOnly: !filters.unreadOnly })}
          />
          <FilterToggle
            label={FILTER_LABELS.starredOnly}
            active={filters.starredOnly}
            onClick={() => onChange({ ...filters, starredOnly: !filters.starredOnly })}
          />
          <FilterToggle
            label={FILTER_LABELS.hasAttachment}
            active={filters.hasAttachment}
            onClick={() => onChange({ ...filters, hasAttachment: !filters.hasAttachment })}
          />

          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          <label className="sr-only" htmlFor={`${ids}-from`}>
            {FILTER_LABELS.from}
          </label>
          <Input
            id={`${ids}-from`}
            value={filters.from}
            inputMode="email"
            placeholder="De : expediteur@…"
            onChange={(event) => onChange({ ...filters, from: event.target.value })}
            className="h-8 w-40"
          />
          <label className="sr-only" htmlFor={`${ids}-to`}>
            {FILTER_LABELS.to}
          </label>
          <Input
            id={`${ids}-to`}
            value={filters.to}
            inputMode="email"
            placeholder="À : destinataire@…"
            onChange={(event) => onChange({ ...filters, to: event.target.value })}
            className="h-8 w-40"
          />

          {active.length > 0 ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 px-2 text-xs"
                onClick={() =>
                  onChange({
                    query: "",
                    from: "",
                    to: "",
                    unreadOnly: false,
                    starredOnly: false,
                    hasAttachment: false,
                    labelId: filters.labelId,
                  })
                }
              >
                {FILTER_LABELS.reset}
              </Button>
              {active.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => onChange(clearFilter(filters, chip.key))}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="min-w-0 truncate">{chip.label}</span>
                  <span aria-hidden>✕</span>
                  <span className="sr-only">Retirer ce filtre</span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {active.length > 0
          ? `${active.length} filtre${active.length > 1 ? "s" : ""} actif${active.length > 1 ? "s" : ""} — ${resultCount} message${resultCount > 1 ? "s" : ""} affiché${resultCount > 1 ? "s" : ""}.`
          : FILTER_LABELS.hint}
      </p>
    </>
  );
}

function FilterToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-xs transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

/** Normalise un critère saisi avant de l'envoyer au service. */
export function filterValue(value: string): string {
  return normalizeFilterValue(value);
}
