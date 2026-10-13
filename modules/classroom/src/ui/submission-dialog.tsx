import { Alert, Button, Dialog, Label } from "@workspace/ui";
import { useEffect, useState } from "react";
import type { AssignmentView, SubmissionAttachmentToken } from "../server.ts";
import {
  removeSubmissionAttachmentFn,
  submitAssignmentFn,
  uploadSubmissionAttachmentFn,
} from "../server.ts";
import { AttachmentPicker, type Notify } from "./attachment-picker.tsx";
import { fileToBase64 } from "./format.ts";
import {
  MAX_SUBMISSION_ATTACHMENT_BYTES,
  MAX_SUBMISSION_ATTACHMENTS,
  MAX_SUBMISSION_CONTENT,
} from "./limits.ts";

/**
 * Copie d'un élève — réponse et pièces jointes dans le même écran. Les
 * fichiers déjà déposés restent visibles (et retirables) ; les nouveaux
 * s'ajoutent à la remise enregistrée, ils ne la remplacent jamais.
 */
export function SubmissionDialog({
  assignment,
  busy = false,
  notify,
  onClose,
  onSubmitted,
}: {
  assignment: AssignmentView | null;
  /** Action de page en cours (suppression de devoir) : la modal est verrouillée. */
  busy?: boolean;
  notify: Notify;
  onClose: () => void;
  onSubmitted: () => void | Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** Jetons d'upload en attente de rattachement à la remise. */
  const [pending, setPending] = useState<SubmissionAttachmentToken[]>([]);

  const mySubmission = assignment?.mySubmission ?? null;
  const existing = mySubmission?.attachments ?? [];

  // Réouvrir la modal préremplit la copie déjà rendue : l'élève la corrige.
  // La dépendance est le devoir entier — un simple `id` ne suffirait pas, la
  // copie enregistrée peut avoir changé (fichier retiré, note ajoutée).
  useEffect(() => {
    if (!assignment) return;
    setContent(assignment.mySubmission?.content ?? "");
    setPending([]);
    setError(null);
  }, [assignment]);

  async function onUpload(files: File[]) {
    setUploading(true);
    try {
      for (const file of files) {
        if (existing.length + pending.length >= MAX_SUBMISSION_ATTACHMENTS) {
          notify("danger", `${MAX_SUBMISSION_ATTACHMENTS} pièces jointes au maximum.`);
          break;
        }
        if (file.size > MAX_SUBMISSION_ATTACHMENT_BYTES) {
          notify("danger", `« ${file.name} » dépasse 10 Mo.`);
          continue;
        }
        notify("info", `Téléversement de « ${file.name} »…`);
        try {
          const token = await uploadSubmissionAttachmentFn({
            data: {
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              contentBase64: await fileToBase64(file),
            },
          });
          setPending((current) => [...current, token]);
          notify("success", `« ${file.name} » sera joint à votre copie.`);
        } catch (caught) {
          notify(
            "danger",
            caught instanceof Error
              ? caught.message
              : `Téléversement de « ${file.name} » impossible.`,
          );
        }
      }
    } finally {
      setUploading(false);
    }
  }

  async function onRemoveExisting(attachmentId: string) {
    setSaving(true);
    try {
      await removeSubmissionAttachmentFn({ data: { attachmentId } });
      await onSubmitted();
      notify("success", "Pièce jointe retirée.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Retrait impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (!assignment) return;
    setSaving(true);
    try {
      await submitAssignmentFn({
        data: {
          assignmentId: assignment.id,
          content,
          attachments: pending.length > 0 ? pending : undefined,
        },
      });
      setPending([]);
      onClose();
      await onSubmitted();
      notify("success", "Copie enregistrée.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Envoi impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (!assignment) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Copie — ${assignment.title}`}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          {/* Libellé distinct du bouton de la liste (« Rendre ma copie ») : un
              seul « Rendre la copie » à l'écran, jamais d'ambiguïté. */}
          <Button
            loading={saving}
            disabled={content.trim().length === 0 || uploading || busy}
            onClick={() => void submit()}
          >
            {mySubmission ? "Mettre ma copie à jour" : "Rendre la copie"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="submission-content">Votre réponse</Label>
          <textarea
            id="submission-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={10}
            maxLength={MAX_SUBMISSION_CONTENT}
            placeholder="Rédigez votre réponse ici, puis ajoutez vos fichiers."
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            autoFocus
          />
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {content.length} / {MAX_SUBMISSION_CONTENT.toLocaleString("fr-FR")} caractères
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Pièces jointes</p>
          <AttachmentPicker
            existing={existing}
            pending={pending}
            busy={saving || uploading || busy}
            notify={notify}
            onUpload={onUpload}
            onRemoveExisting={(attachment) => void onRemoveExisting(attachment.id)}
            onRemovePending={(storageKey) =>
              setPending((current) => current.filter((token) => token.storageKey !== storageKey))
            }
          />
        </div>

        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}
