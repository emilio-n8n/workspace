import { cn, Input } from "@workspace/ui";
import { type KeyboardEvent, useCallback, useState } from "react";
import { parseKey } from "../formula.ts";
import type { CellTone } from "./cell-tone.ts";

export type FormulaBarProps = {
  /** Référence de la cellule active (« A1 »), ou chaîne vide sans sélection. */
  reference: string;
  /** Valeur brute de la cellule active (ce que contient vraiment la cellule). */
  value: string;
  /** Valeur calculée, pour l'aperçu pendant la saisie (« 12 », « #ERREUR »…). */
  result: string | null;
  tone: CellTone;
  disabled: boolean;
  /** Écrit la valeur puis déplace la sélection (« none » = sur place). */
  onSubmit: (value: string, move: "down" | "right" | "none") => void;
  /** Signale le brouillon en cours (null quand la barre affiche la cellule). */
  onDraftChange: (draft: string | null) => void;
  /** Déplacement vers une référence saisie dans la boîte de nom. */
  onGoTo: (reference: string) => void;
};

/** Longueur maximale acceptée : celle du service (`MAX_CELL_CHARS`). */
const MAX_VALUE_CHARS = 1000;

/**
 * Barre de formule : boîte de nom (référence) et champ de saisie de la valeur
 * brute de la cellule active.
 *
 * La barre montre toujours la donnée stockée (une formule reste une formule),
 * l'aperçu affiche le résultat calculé pendant la frappe. Entrée valide et
 * descend, Tab valide et passe à droite, Échap annule la saisie en cours,
 * la perte du focus valide. La boîte de nom accepte une référence (« B4 ») et
 * déplace la sélection ; elle signale une référence invalide en français.
 */
export function FormulaBar({
  reference,
  value,
  result,
  tone,
  disabled,
  onSubmit,
  onDraftChange,
  onGoTo,
}: FormulaBarProps) {
  // Brouillon local, rattaché à la cellule pour laquelle il a été saisi : un
  // brouillon d'une autre cellule est ignoré, donc aucune saisie ne fuit d'une
  // cellule à la suivante.
  const [draft, setDraft] = useState<{ reference: string; value: string } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const active = reference.length > 0;
  const currentDraft = draft?.reference === reference ? draft.value : null;
  const shown = currentDraft ?? value;

  /** Abandonne la saisie en cours : la barre réaffiche la valeur enregistrée. */
  const clearDraft = useCallback(() => {
    setDraft(null);
    onDraftChange(null);
  }, [onDraftChange]);

  const submit = useCallback(
    (move: "down" | "right" | "none") => {
      onSubmit(currentDraft ?? value, move);
      clearDraft();
    },
    [clearDraft, currentDraft, onSubmit, value],
  );

  const onValueKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit("down");
      } else if (event.key === "Tab") {
        event.preventDefault();
        submit("right");
      } else if (event.key === "Escape") {
        event.preventDefault();
        clearDraft();
        event.currentTarget.select();
      }
    },
    [clearDraft, submit],
  );

  const onNameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const text = event.currentTarget.value.trim();
      if (event.key === "Enter") {
        event.preventDefault();
        const target = parseKey(text.toUpperCase());
        if (!target) {
          setNameError(`Référence « ${text} » invalide (attendu : A1, B4, AA10…).`);
          return;
        }
        setNameError(null);
        event.currentTarget.blur();
        onGoTo(text.toUpperCase());
      } else if (event.key === "Escape") {
        event.preventDefault();
        setNameError(null);
        event.currentTarget.blur();
      }
    },
    [onGoTo],
  );

  const tooLong = shown.length > MAX_VALUE_CHARS;

  return (
    <fieldset
      aria-label="Barre de formule"
      className="flex min-w-0 flex-nowrap items-center gap-2 border-b border-border bg-card px-2 py-1"
    >
      <div className="relative shrink-0">
        <Input
          aria-label="Référence de cellule"
          value={reference}
          disabled={disabled || !active}
          spellCheck={false}
          onChange={() => undefined}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => setNameError(null)}
          onKeyDown={onNameKeyDown}
          className="h-8 w-20 px-2 text-center font-mono text-xs tabular-nums"
        />
        {nameError ? (
          <span
            role="alert"
            className="absolute top-full left-0 z-10 mt-1 w-64 rounded-md border border-destructive/40 bg-card px-2 py-1 text-[11px] text-destructive shadow-soft"
          >
            {nameError}
          </span>
        ) : null}
      </div>

      <span aria-hidden className="h-6 w-px shrink-0 bg-border" />
      <span aria-hidden className="shrink-0 px-1 font-display text-sm italic text-muted-foreground">
        fx
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Input
          aria-label={active ? `Valeur ou formule de ${reference}` : "Valeur ou formule"}
          aria-describedby="sheet-formula-aide"
          value={shown}
          disabled={disabled || !active}
          spellCheck={false}
          placeholder={active ? undefined : "Sélectionnez une cellule pour la modifier"}
          onChange={(event) => {
            setDraft({ reference, value: event.target.value });
            onDraftChange(event.target.value);
          }}
          onBlur={() => {
            if (currentDraft !== null && currentDraft !== value) submit("none");
            else clearDraft();
          }}
          onKeyDown={onValueKeyDown}
          className={cn(
            "h-8 w-full min-w-0 flex-1 font-mono text-xs",
            tooLong && "border-destructive text-destructive",
            tone === "error" && !tooLong && "text-destructive",
          )}
        />
        {active ? (
          <span
            aria-hidden
            className={cn(
              "max-w-48 shrink-0 truncate text-xs tabular-nums",
              tone === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {result === null ? "" : `= ${result}`}
          </span>
        ) : null}
      </div>

      <span id="sheet-formula-aide" className="sr-only">
        Entrée valide et descend d'une ligne, Tab valide et passe à la colonne suivante, Échap
        annule la saisie.
      </span>
      {tooLong ? (
        <span role="alert" className="shrink-0 text-[11px] text-destructive">
          Valeur limitée à {MAX_VALUE_CHARS} caractères.
        </span>
      ) : null}
    </fieldset>
  );
}
