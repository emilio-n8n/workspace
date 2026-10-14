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
 * Bandeau de filtres : recherche plein texte, expéditeur, destinataire et
 * interrupteurs (non lus, suivis, pièce jointe). L'état des filtres est
 * toujours visible — chaque filtre actif est une puce annulable, et le
 * changement est annoncé (aria-live) avec le nombre de résultats.
 */
export function FilterBar({ filters, resultCount, labels, onChange, inputRef }: FilterBarProps) {
  const ids = useId();
  const active = activeFilters(filters, labels.find((label) => label.id === filters.labelId)?.name);

  return (
    <div className="flex flex-col gap-2 border-b border-border p-2">
      <div className="flex flex-col gap-1">
        <label className="sr-only" htmlFor={`${ids}-query`}>
          {FILTER_LABELS.query}
        </label>
        <Input
          id={`${ids}-query`}
          ref={inputRef}
          value={filters.query}
          placeholder="Rechercher… (touche /)"
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          className="h-8"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="sr-only" htmlFor={`${ids}-from`}>
            {FILTER_LABELS.from}
          </label>
          <Input
            id={`${ids}-from`}
            value={filters.from}
            inputMode="email"
            placeholder="De : expediteur@…"
            onChange={(event) => onChange({ ...filters, from: event.target.value })}
            className="h-8"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="sr-only" htmlFor={`${ids}-to`}>
            {FILTER_LABELS.to}
          </label>
          <Input
            id={`${ids}-to`}
            value={filters.to}
            inputMode="email"
            placeholder="À : destinataire@…"
            onChange={(event) => onChange({ ...filters, to: event.target.value })}
            className="h-8"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
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
        {active.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-xs"
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
        ) : null}
      </div>

      {active.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-1" aria-label="Filtres actifs">
          {active.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                onClick={() => onChange(clearFilter(filters, chip.key))}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <span className="min-w-0 truncate">{chip.label}</span>
                <span aria-hidden>✕</span>
                <span className="sr-only">Retirer ce filtre</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p aria-live="polite" className="text-[11px] text-muted-foreground">
        {active.length > 0
          ? `${active.length} filtre${active.length > 1 ? "s" : ""} actif${active.length > 1 ? "s" : ""} — ${resultCount} message${resultCount > 1 ? "s" : ""} affiché${resultCount > 1 ? "s" : ""}.`
          : FILTER_LABELS.hint}
      </p>
    </div>
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
