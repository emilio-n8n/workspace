import { Button, cn, Input, Label } from "@workspace/ui";
import { type FormEvent, useState } from "react";
import type { TaskLabelColor } from "../schema.ts";
import type { TaskLabelView } from "../server.ts";
import { LABEL_COLOR_LABELS, labelDotClass, TASK_LABEL_COLOR_VALUES } from "./task-visuals.tsx";

/**
 * Sélecteur d'étiquettes d'une tâche.
 *
 * Chaque étiquette est une CASE À COCHER ÉTIQUETÉE (`<label for>`), pas une
 * pastille cliquable : l'étiquette reste utilisable au clavier et annoncée par
 * les lecteurs d'écran. La création est inline pour ne pas ouvrir un deuxième
 * dialogue depuis le dialogue d'édition.
 */
export function TaskLabelsEditor({
  labels,
  selectedIds,
  busy,
  onToggle,
  onCreate,
}: {
  labels: TaskLabelView[];
  selectedIds: readonly string[];
  busy?: boolean;
  onToggle: (labelId: string, checked: boolean) => void;
  /** Renvoie l'identifiant de l'étiquette créée, ou `null` en cas d'échec. */
  onCreate: (name: string, color: TaskLabelColor) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<TaskLabelColor>("blue");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = name.trim();
    if (clean.length === 0 || creating) return;

    setCreating(true);
    setMessage(null);
    const createdId = await onCreate(clean, color);
    setCreating(false);
    if (createdId) {
      setName("");
      // Fraîchement créée, elle est cochée : personne ne recoche à la main.
      onToggle(createdId, true);
      setMessage(`Étiquette « ${clean} » créée et attribuée.`);
    } else {
      setMessage("Création impossible : ce nom est peut-être déjà pris.");
    }
  }

  return (
    <fieldset className="flex flex-col gap-3" disabled={busy}>
      <legend className="text-sm font-medium">Étiquettes</legend>

      {labels.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Aucune étiquette pour l'instant. Créez la première ci-dessous.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {labels.map((label) => (
            <li key={label.id} className="flex items-center gap-2">
              <input
                id={`task-label-${label.id}`}
                type="checkbox"
                className="accent-primary"
                checked={selectedIds.includes(label.id)}
                disabled={busy}
                onChange={(event) => onToggle(label.id, event.target.checked)}
              />
              <Label
                htmlFor={`task-label-${label.id}`}
                className="flex min-w-0 items-center gap-2 text-sm font-normal"
              >
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-full", labelDotClass(label.color))}
                />
                <span className="truncate">{label.name}</span>
              </Label>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={submit}
        method="post"
        aria-busy={creating || undefined}
        className="flex flex-wrap items-end gap-2"
      >
        <div className="flex min-w-40 flex-1 flex-col gap-1.5">
          <Label htmlFor="new-label-name" className="text-xs">
            Nouvelle étiquette
          </Label>
          <Input
            id="new-label-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Urgent"
            maxLength={40}
            disabled={busy || creating}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-label-color" className="text-xs">
            Couleur
          </Label>
          <select
            id="new-label-color"
            value={color}
            onChange={(event) => setColor(event.target.value as TaskLabelColor)}
            disabled={busy || creating}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {TASK_LABEL_COLOR_VALUES.map((value) => (
              <option key={value} value={value}>
                {LABEL_COLOR_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" loading={creating} disabled={name.trim().length === 0}>
          Ajouter
        </Button>
      </form>

      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}
