import { cn, Input, Label } from "@workspace/ui";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import {
  chipRemoveLabel,
  inputToChips,
  parseRecipientInput,
  type RecipientChip,
  type RecipientField,
} from "./recipients.ts";

export type RecipientFieldInputProps = {
  field: RecipientField;
  /** Libellé affiché — associé au champ par `htmlFor`. */
  label: string;
  /** Aide courte sous le champ (bornes, séparateurs acceptés). */
  hint?: string;
  chips: RecipientChip[];
  /** Saisie en cours, pas encore transformée en puce. */
  draft: string;
  disabled?: boolean;
  /** Le total de destinataires a atteint la borne : les nouveaux sont refusés. */
  full?: boolean;
  onDraftChange: (value: string) => void;
  /** Applique le résultat de la transformation de la saisie en puces. */
  onCommit: (result: { chips: RecipientChip[]; rest: string }) => void;
  onRemove: (value: string) => void;
  /** Contenu aligné à droite du libellé (ex. bouton « Cci »). */
  labelExtra?: ReactNode;
};

/**
 * Champ de destinataires en puces : la saisie reste un champ texte libre (on
 * peut coller une liste d'adresses séparées par des virgules), et chaque
 * adresse reconnue devient une puce supprimable au clavier comme à la souris.
 * Le refus d'une adresse mal formée est toujours expliqué, jamais silencieux.
 */
export function RecipientFieldInput({
  field,
  label,
  hint,
  chips,
  draft,
  disabled = false,
  full = false,
  onDraftChange,
  onCommit,
  onRemove,
  labelExtra,
}: RecipientFieldInputProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [invalid, setInvalid] = useState<string | null>(null);

  /** Transforme la saisie en puces ; ce qui reste repart dans le champ. */
  function commit() {
    if (draft.trim().length === 0) return;
    const result = inputToChips(draft, chips);
    const rejected = parseRecipientInput(result.rest)[0];
    setInvalid(
      rejected
        ? `« ${rejected} » n'est pas une adresse valide — corrigez-la avant d'envoyer.`
        : null,
    );
    onCommit(result);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "Tab" || event.key === "," || event.key === ";") {
      if (draft.trim().length > 0) {
        event.preventDefault();
        commit();
      }
      return;
    }
    if (event.key === "Backspace" && draft.length === 0 && chips.length > 0) {
      // Champ vide : Effacement retire la dernière puce, comme attendu.
      event.preventDefault();
      onRemove(chips[chips.length - 1]?.value ?? "");
      return;
    }
    if (event.key === "ArrowLeft" && draft.length === 0 && chips.length > 0) {
      const target =
        event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[data-chip="last"]');
      if (target) {
        event.preventDefault();
        target.focus();
      }
    }
  }

  const hintId = hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId}>{label}</Label>
        {labelExtra}
      </div>
      <div
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background p-1 shadow-soft",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {chips.map((chip, index) => (
          <span
            key={chip.value}
            className="inline-flex max-w-full items-center gap-1 rounded bg-muted py-0.5 pl-2 pr-1 text-xs text-foreground"
          >
            <span className="min-w-0 truncate" title={chip.value}>
              {chip.label}
            </span>
            <button
              type="button"
              data-chip={index === chips.length - 1 ? "last" : undefined}
              aria-label={chipRemoveLabel(chip, field)}
              disabled={disabled}
              onClick={() => onRemove(chip.value)}
              className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none"
            >
              <svg
                viewBox="0 0 16 16"
                className="size-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </span>
        ))}
        <Input
          id={inputId}
          ref={inputRef}
          value={draft}
          disabled={disabled}
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          aria-describedby={hintId}
          aria-invalid={invalid !== null || undefined}
          placeholder={chips.length === 0 ? "prenom.nom@exemple.org" : "Ajouter…"}
          onChange={(event) => {
            onDraftChange(event.target.value);
            if (invalid) setInvalid(null);
          }}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className="h-7 min-w-[9rem] flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
      {invalid ? (
        <p role="alert" className="text-xs text-destructive">
          {invalid}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {full ? (
        <p className="text-xs text-muted-foreground">
          20 destinataires au maximum (À, Cc et Cci confondus).
        </p>
      ) : null}
    </div>
  );
}
