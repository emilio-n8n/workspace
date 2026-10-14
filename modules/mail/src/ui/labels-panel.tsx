import { Button, cn, Dialog, Input, Label } from "@workspace/ui";
import { type FormEvent, useEffect, useId, useState } from "react";
import { LABEL_COLORS, MAX_LABEL_NAME_LENGTH } from "../label-colors.ts";
import { createLabelFn, deleteLabelFn, updateLabelFn } from "../server.ts";
import { LabelChip } from "./label-chip.tsx";
import { labelDotClasses, labelSwatchRing } from "./label-tokens.ts";

export type LabelsPanelProps = {
  labels: { id: string; name: string; color: string; total: number; unread: number }[];
  /** Libellé servant de filtre actif. */
  activeLabelId: string | null;
  onSelect: (labelId: string | null) => void;
  onManage: () => void;
};

/**
 * Panneau latéral des libellés personnels : cliquer filtre la liste, la
 * pastille porte la couleur, le total et les non lus rappellent l'état.
 */
export function LabelsPanel({ labels, activeLabelId, onSelect, onManage }: LabelsPanelProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-1 px-2">
        <p className="text-xs font-medium text-muted-foreground">Libellés</p>
        <button
          type="button"
          onClick={onManage}
          className="rounded px-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Gérer
        </button>
      </div>
      {labels.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">Aucun libellé.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {labels.map((label) => (
            <li key={label.id}>
              <button
                type="button"
                aria-pressed={label.id === activeLabelId}
                onClick={() => onSelect(label.id === activeLabelId ? null : label.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                  label.id === activeLabelId
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cn("size-2.5 shrink-0 rounded-full", labelDotClasses(label.color))}
                />
                <span className="min-w-0 flex-1 truncate">{label.name}</span>
                {label.unread > 0 ? (
                  <span className="shrink-0 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    {label.unread}
                  </span>
                ) : null}
                <span className="shrink-0 text-xs text-muted-foreground">{label.total}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type ManageLabelsDialogProps = {
  open: boolean;
  onClose: () => void;
  labels: { id: string; name: string; color: string; createdAt: string }[];
  onChanged: () => void;
  onError: (message: string) => void;
};

type DraftLabel = { id?: string; name: string; color: string };

/**
 * Gestion des libellés : créer, renommer, changer la couleur, supprimer.
 * Le nom en doublon et la couleur inconnue sont refusés par le service avec un
 * message en français, jamais silencieusement.
 */
export function ManageLabelsDialog({
  open,
  onClose,
  labels,
  onChanged,
  onError,
}: ManageLabelsDialogProps) {
  const [draft, setDraft] = useState<DraftLabel>({
    name: "",
    color: LABEL_COLORS[2]?.key ?? "bleu",
  });
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const nameId = useId();

  useEffect(() => {
    if (open) {
      setDraft({ name: "", color: LABEL_COLORS[2]?.key ?? "bleu" });
      setConflict(null);
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();
    if (name.length === 0) {
      setConflict("Donnez un nom au libellé.");
      return;
    }
    setBusy(true);
    try {
      if (draft.id) {
        await updateLabelFn({ data: { id: draft.id, name, color: draft.color } });
      } else {
        await createLabelFn({ data: { name, color: draft.color } });
      }
      setDraft({ name: "", color: LABEL_COLORS[2]?.key ?? "bleu" });
      setConflict(null);
      onChanged();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Enregistrement impossible.";
      setConflict(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(labelId: string) {
    setBusy(true);
    try {
      await deleteLabelFn({ data: { id: labelId } });
      if (draft.id === labelId) setDraft({ name: "", color: LABEL_COLORS[2]?.key ?? "bleu" });
      onChanged();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Gérer les libellés" className="max-w-lg">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1">
          {labels.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              Aucun libellé pour l'instant — créez le premier ci-dessous.
            </li>
          ) : (
            labels.map((label) => (
              <li
                key={label.id}
                className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5"
              >
                <span
                  aria-hidden
                  className={cn("size-2.5 shrink-0 rounded-full", labelDotClasses(label.color))}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{label.name}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={busy}
                  onClick={() => setDraft({ id: label.id, name: label.name, color: label.color })}
                >
                  Modifier
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-destructive"
                  disabled={busy}
                  onClick={() => void remove(label.id)}
                >
                  Supprimer
                </Button>
              </li>
            ))
          )}
        </ul>

        <form onSubmit={submit} className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm font-medium">
            {draft.id ? "Modifier le libellé" : "Nouveau libellé"}
          </p>
          <div className="flex flex-col gap-1">
            <Label htmlFor={nameId}>Nom</Label>
            <Input
              id={nameId}
              value={draft.name}
              maxLength={MAX_LABEL_NAME_LENGTH}
              placeholder="Clients, Fournisseurs, À relire…"
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
                setConflict(null);
              }}
            />
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium leading-none text-foreground">Couleur</legend>
            <div className="flex flex-wrap items-center gap-2">
              {LABEL_COLORS.map((color) => (
                <button
                  key={color.key}
                  type="button"
                  aria-label={`Couleur ${color.label}`}
                  aria-pressed={draft.color === color.key}
                  onClick={() => setDraft({ ...draft, color: color.key })}
                  className={cn(
                    "grid size-8 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-background transition-transform",
                    labelSwatchRing(color.key, draft.color === color.key),
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-5 rounded-full", labelDotClasses(color.key))}
                  />
                </button>
              ))}
            </div>
          </fieldset>
          {conflict ? (
            <p role="alert" className="text-xs text-destructive">
              {conflict}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {draft.id ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft({ name: "", color: LABEL_COLORS[2]?.key ?? "bleu" });
                  setConflict(null);
                }}
              >
                Annuler la modification
              </Button>
            ) : null}
            <Button type="submit" loading={busy}>
              {draft.id ? "Enregistrer" : "Créer le libellé"}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

/** Aperçu d'un libellé, utilisé dans la lecture pour appliquer/retirer. */
export function LabelAssignment({
  messageLabels,
  allLabels,
  busy = false,
  onApply,
}: {
  messageLabels: { id: string; name: string; color: string }[];
  allLabels: { id: string; name: string; color: string }[];
  busy?: boolean;
  onApply: (labelIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(() => messageLabels.map((label) => label.id));
  const buttonId = useId();

  useEffect(() => {
    setPicked(messageLabels.map((label) => label.id));
  }, [messageLabels]);

  const selected = allLabels.filter((label) => picked.includes(label.id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {messageLabels.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun libellé.</p>
        ) : (
          messageLabels.map((label) => <LabelChip key={label.id} label={label} />)
        )}
        {allLabels.length > 0 ? (
          <button
            type="button"
            id={buttonId}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="rounded px-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {open
              ? "Terminer"
              : messageLabels.length > 0
                ? "Modifier les libellés"
                : "Ajouter un libellé"}
          </button>
        ) : null}
      </div>

      {open ? (
        <ul className="flex flex-wrap items-center gap-1" aria-label="Libellés disponibles">
          {allLabels.map((label) => {
            const active = picked.includes(label.id);
            return (
              <li key={label.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setPicked((current) =>
                      current.includes(label.id)
                        ? current.filter((id) => id !== label.id)
                        : [...current, label.id],
                    )
                  }
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors",
                    active ? "bg-accent text-accent-foreground" : "bg-muted text-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-2 rounded-full", labelDotClasses(label.color))}
                  />
                  {label.name}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            loading={busy}
            onClick={() => {
              onApply(picked);
              setOpen(false);
            }}
          >
            Appliquer ({selected.length})
          </Button>
          <p className="text-xs text-muted-foreground">
            {selected.length === 0
              ? "Aucun libellé sélectionné — le message en perdra tous."
              : selected.map((label) => label.name).join(", ")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
