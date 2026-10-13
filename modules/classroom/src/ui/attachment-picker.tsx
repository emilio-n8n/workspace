import { Button, FileIcon, type ToastTone } from "@workspace/ui";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import type { SubmissionAttachmentMeta, SubmissionAttachmentToken } from "../server.ts";
import { fmtSize } from "./format.ts";
import { MAX_SUBMISSION_ATTACHMENT_BYTES, MAX_SUBMISSION_ATTACHMENTS } from "./limits.ts";

/** Message éphémère (toast) affiché à l'utilisateur. */
export type Notify = (tone: ToastTone, message: string) => void;

/**
 * Compose les pièces jointes d'une copie : les fichiers déjà déposés (que
 * l'élève peut retirer) et ceux en attente de rattachement à la prochaine
 * remise. Le dépôt se fait au clic comme au glisser-déposer ; chaque refus
 * (limite de 5 fichiers, taille de 10 Mo) est annoncé par toast, sans jamais
 * voler le focus au formulaire.
 */
export function AttachmentPicker({
  existing,
  pending,
  busy = false,
  notify,
  onUpload,
  onRemoveExisting,
  onRemovePending,
}: {
  /** Pièces jointes déjà rattachées à la copie enregistrée. */
  existing: SubmissionAttachmentMeta[];
  /** Jetons d'upload en attente de rattachement à la remise. */
  pending: SubmissionAttachmentToken[];
  /** Envoi de la copie en cours : le dépôt est verrouillé. */
  busy?: boolean;
  notify: Notify;
  onUpload: (files: File[]) => void | Promise<void>;
  onRemoveExisting: (attachment: SubmissionAttachmentMeta) => void;
  onRemovePending: (storageKey: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const count = existing.length + pending.length;
  const remaining = MAX_SUBMISSION_ATTACHMENTS - count;

  function onFiles(files: File[]) {
    if (files.length === 0) return;
    if (remaining <= 0) {
      notify("danger", `${MAX_SUBMISSION_ATTACHMENTS} pièces jointes au maximum.`);
      return;
    }
    const accepted = files.slice(0, remaining);
    if (accepted.length < files.length) {
      notify("danger", `${MAX_SUBMISSION_ATTACHMENTS} pièces jointes au maximum.`);
    }
    const oversized = accepted.find((file) => file.size > MAX_SUBMISSION_ATTACHMENT_BYTES);
    if (oversized) {
      notify("danger", `« ${oversized.name} » dépasse 10 Mo.`);
    }
    const kept = accepted.filter((file) => file.size <= MAX_SUBMISSION_ATTACHMENT_BYTES);
    if (kept.length > 0) void onUpload(kept);
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    // Réinitialisation immédiate : sélectionner deux fois le même fichier doit
    // déclencher un nouveau changement.
    event.target.value = "";
    onFiles(files);
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    onFiles([...(event.dataTransfer?.files ?? [])]);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Un seul contrôle pour les deux voies de dépôt : le clic (clavier
          compris, c'est un vrai bouton) et le glisser-déposer. */}
      <button
        type="button"
        disabled={busy || remaining <= 0}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={
          dragging
            ? "flex flex-wrap items-center justify-center gap-2 rounded-md border border-dashed border-ring bg-muted px-3 py-4 text-center text-sm text-foreground transition-colors"
            : "flex flex-wrap items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        <span className="font-medium text-foreground">
          {dragging ? "Déposez les fichiers ici" : "Ajouter des fichiers"}
        </span>
        <span>ou glissez-déposez · 10 Mo chacun</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        aria-label="Ajouter des pièces jointes à ma copie"
        onChange={onInputChange}
      />
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {count} / {MAX_SUBMISSION_ATTACHMENTS} fichiers joints
      </p>

      {count > 0 ? (
        <ul aria-label="Pièces jointes de ma copie" className="flex flex-col gap-1">
          {existing.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
            >
              <FileIcon
                kind="file"
                mimeType={attachment.contentType}
                name={attachment.filename}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1 truncate" title={attachment.filename}>
                {attachment.filename}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {fmtSize(attachment.sizeBytes)}
              </span>
              <span className="shrink-0 text-muted-foreground">déjà déposé</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Retirer ${attachment.filename}`}
                disabled={busy}
                onClick={() => onRemoveExisting(attachment)}
              >
                Retirer
              </Button>
            </li>
          ))}
          {pending.map((attachment) => (
            <li
              key={attachment.storageKey}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-xs"
            >
              <FileIcon
                kind="file"
                mimeType={attachment.contentType}
                name={attachment.filename}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1 truncate" title={attachment.filename}>
                {attachment.filename}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {fmtSize(attachment.sizeBytes)}
              </span>
              <span className="shrink-0 text-muted-foreground">à joindre</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Retirer ${attachment.filename}`}
                disabled={busy}
                onClick={() => onRemovePending(attachment.storageKey)}
              >
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
