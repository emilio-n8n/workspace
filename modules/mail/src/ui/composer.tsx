import { Button, Dialog, Input, Label } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { saveDraftFn, sendMailFn, uploadMailAttachmentFn } from "../server.ts";
import { attachmentKey, contentTypeOf, readFileAsBase64 } from "./attachment-upload.ts";
import {
  type ComposerAttachment,
  extractAttachmentName,
  isAttachmentTooLarge,
  oversizedMessage,
  readyAttachments,
  remainingSlots,
  tooManyMessage,
} from "./attachments.ts";
import {
  ATTACHMENTS_DRAFT_NOTICE,
  AUTOSAVE_DELAY_MS,
  type AutosaveState,
  autosaveLabel,
  type DraftContent,
  hasDraftContent,
  shouldAutosave,
} from "./autosave.ts";
import { ComposerAttachments } from "./composer-attachments.tsx";
import { RecipientFieldInput } from "./recipient-field.tsx";
import {
  addressesToChips,
  chipsToAddresses,
  countRecipients,
  MAX_RECIPIENT_CHIPS,
  parseRecipientInput,
  type RecipientChip,
  type RecipientField,
} from "./recipients.ts";

/** Point de départ du compositeur : réponse, brouillon existant ou page blanche. */
export type ComposerSeed = {
  id?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
};

export const EMPTY_SEED: ComposerSeed = { to: [], cc: [], bcc: [], subject: "", body: "" };

export type ComposerDialogProps = {
  seed: ComposerSeed;
  onClose: () => void;
  /** Après un envoi : le message est conservé dans « Envoyés ». */
  onSent: (result: { id: string; sendError: string | null }) => void;
  /** Après tout enregistrement de brouillon (automatique ou manuel). */
  onDraftSaved: () => void;
  /** Remonte un message utilisateur (toast). */
  onError: (message: string) => void;
};

type FieldState = { chips: RecipientChip[]; draft: string };

function toFieldState(addresses: string[]): FieldState {
  return { chips: addressesToChips(addresses), draft: "" };
}

/**
 * Compositeur de message — destinataires en puces (À, Cc, Cci), brouillon
 * automatique après une pause de frappe, pièces jointes avec reprise d'erreur.
 * Rien n'est jamais jeté : fermer la fenêtre enregistre le brouillon en cours.
 */
export function ComposerDialog({
  seed,
  onClose,
  onSent,
  onDraftSaved,
  onError,
}: ComposerDialogProps) {
  const [fields, setFields] = useState<Record<RecipientField, FieldState>>(() => ({
    to: toFieldState(seed.to),
    cc: toFieldState(seed.cc),
    bcc: toFieldState(seed.bcc),
  }));
  const [subject, setSubject] = useState(seed.subject);
  const [body, setBody] = useState(seed.body);
  const [showBcc, setShowBcc] = useState(seed.bcc.length > 0);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>(seed.id);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [autosave, setAutosave] = useState<{ state: AutosaveState; savedAt: Date | null }>({
    state: "idle",
    savedAt: null,
  });

  /** Fichiers d'origine, conservés pour la reprise après échec. */
  const filesRef = useRef(new Map<string, File>());
  const lastSavedRef = useRef<number | null>(null);
  const saltRef = useRef(0);
  const stateRef = useRef({ fields, subject, body, attachments, draftId });
  stateRef.current = { fields, subject, body, attachments, draftId };

  /**
   * Contenu transmis au service, saisie en cours comprise : une adresse tapée
   * mais pas encore transformée en puce fait quand même partie du message.
   */
  const collect = useCallback((): DraftContent => {
    const current = stateRef.current;
    const withPending = (field: RecipientField): string[] => [
      ...chipsToAddresses(current.fields[field].chips),
      ...parseRecipientInput(current.fields[field].draft),
    ];
    return {
      to: withPending("to"),
      cc: withPending("cc"),
      bcc: withPending("bcc"),
      subject: current.subject,
      body: current.body,
    };
  }, []);

  const recipientTotal = countRecipients(
    { to: fields.to.chips, cc: fields.cc.chips, bcc: fields.bcc.chips },
    `${fields.to.draft} ${fields.cc.draft} ${fields.bcc.draft}`,
  );

  // -------------------------------------------------------------------------
  // Brouillon automatique
  // -------------------------------------------------------------------------

  const saveDraft = useCallback(
    async (automatic: boolean) => {
      const content = collect();
      const id = stateRef.current.draftId;
      setAutosave((current) => ({ state: "saving", savedAt: current.savedAt }));
      try {
        const result = await saveDraftFn({
          data: {
            id,
            to: content.to,
            cc: content.cc,
            bcc: content.bcc,
            subject: content.subject,
            body: content.body,
          },
        });
        setDraftId(result.id);
        setDirty(false);
        lastSavedRef.current = Date.now();
        setAutosave({ state: "saved", savedAt: new Date() });
        onDraftSaved();
        // Un enregistrement explicite referme le compositeur ; l'automatique
        // laisse la saisie en cours (c'est tout son intérêt).
        if (!automatic) onClose();
      } catch (caught) {
        setAutosave({ state: "error", savedAt: null });
        // Une panne d'enregistrement ne doit jamais faire perdre la saisie :
        // le message reste affiché dans le compositeur, la reprise est manuelle.
        onError(
          automatic
            ? "Enregistrement automatique du brouillon interrompu — cliquez sur « Enregistrer en brouillon »."
            : caught instanceof Error
              ? caught.message
              : "Enregistrement impossible.",
        );
      }
    },
    [collect, onClose, onDraftSaved, onError],
  );

  const uploading = attachments.some(
    (item) => item.phase === "reading" || item.phase === "uploading",
  );

  useEffect(() => {
    const decision = shouldAutosave({
      draft: collect(),
      dirty,
      saving: autosave.state === "saving",
      lastSavedAt: lastSavedRef.current,
      now: Date.now(),
      uploading,
    });
    if (!decision) return;
    const timer = setTimeout(() => {
      void saveDraft(true);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [collect, dirty, uploading, saveDraft, autosave.state]);

  /** Fermeture : le brouillon en cours est enregistré avant de disparaître. */
  const requestClose = useCallback(() => {
    if (dirty && hasDraftContent(collect())) {
      void saveDraft(true).then(onClose);
      return;
    }
    onClose();
  }, [collect, dirty, onClose, saveDraft]);

  // -------------------------------------------------------------------------
  // Pièces jointes
  // -------------------------------------------------------------------------

  const uploadOne = useCallback(async (key: string, file: File, name: string) => {
    setAttachments((current) =>
      current.map((item) =>
        item.key === key ? { ...item, phase: "reading", loadedBytes: 0, error: undefined } : item,
      ),
    );
    try {
      const contentBase64 = await readFileAsBase64(file, (loaded) => {
        setAttachments((current) =>
          current.map((item) => (item.key === key ? { ...item, loadedBytes: loaded } : item)),
        );
      });
      setAttachments((current) =>
        current.map((item) => (item.key === key ? { ...item, phase: "uploading" } : item)),
      );
      const token = await uploadMailAttachmentFn({
        data: { filename: name, contentType: contentTypeOf(file), contentBase64 },
      });
      setAttachments((current) =>
        current.map((item) =>
          item.key === key ? { ...item, phase: "ready", loadedBytes: item.sizeBytes, token } : item,
        ),
      );
    } catch (caught) {
      setAttachments((current) =>
        current.map((item) =>
          item.key === key
            ? {
                ...item,
                phase: "error",
                error:
                  caught instanceof Error
                    ? caught.message
                    : `Téléversement de « ${name} » impossible — réessayez.`,
              }
            : item,
        ),
      );
    }
  }, []);

  const onPickAttachments = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const remaining = remainingSlots(stateRef.current.attachments);
      if (remaining <= 0) {
        onError(tooManyMessage(files.length, 0));
        return;
      }
      if (files.length > remaining) {
        onError(tooManyMessage(files.length, remaining));
      }
      for (const file of files.slice(0, remaining)) {
        const name = extractAttachmentName(file.name);
        if (name.length === 0) {
          onError("Fichier sans nom — choisissez-le depuis votre explorateur.");
          continue;
        }
        if (isAttachmentTooLarge(file.size)) {
          onError(oversizedMessage(name));
          continue;
        }
        saltRef.current += 1;
        const key = attachmentKey(file, saltRef.current);
        filesRef.current.set(key, file);
        setAttachments((list) => [
          ...list,
          {
            key,
            name,
            sizeBytes: file.size,
            contentType: contentTypeOf(file),
            phase: "reading",
            loadedBytes: 0,
          },
        ]);
        void uploadOne(key, file, name);
      }
    },
    [onError, uploadOne],
  );

  const onRetryAttachment = useCallback(
    (key: string) => {
      const file = filesRef.current.get(key);
      if (!file) return;
      void uploadOne(key, file, extractAttachmentName(file.name) || file.name);
    },
    [uploadOne],
  );

  const onRetryAll = useCallback(() => {
    for (const item of stateRef.current.attachments) {
      if (item.phase === "error") onRetryAttachment(item.key);
    }
  }, [onRetryAttachment]);

  const onRemoveAttachment = useCallback((key: string) => {
    filesRef.current.delete(key);
    setAttachments((current) => current.filter((item) => item.key !== key));
  }, []);

  // -------------------------------------------------------------------------
  // Envoi
  // -------------------------------------------------------------------------

  const onSend = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const content = collect();
      if (content.to.length === 0) {
        onError("Ajoutez au moins un destinataire avant d'envoyer.");
        return;
      }
      setBusy(true);
      try {
        const tokens = readyAttachments(stateRef.current.attachments)
          .map((item) => item.token)
          .filter((token) => token !== undefined);
        const result = await sendMailFn({
          data: {
            id: stateRef.current.draftId,
            to: content.to,
            cc: content.cc,
            bcc: content.bcc,
            subject: content.subject,
            body: content.body,
            attachments: tokens.length > 0 ? tokens : undefined,
          },
        });
        onSent(result);
      } catch (caught) {
        onError(caught instanceof Error ? caught.message : "Envoi impossible.");
      } finally {
        setBusy(false);
      }
    },
    [collect, onError, onSent],
  );

  function patchField(field: RecipientField, patch: Partial<FieldState>) {
    setFields((current) => ({ ...current, [field]: { ...current[field], ...patch } }));
    setDirty(true);
  }

  function removeChip(field: RecipientField, value: string) {
    setFields((current) => ({
      ...current,
      [field]: {
        ...current[field],
        chips: current[field].chips.filter((chip) => chip.value !== value),
      },
    }));
    setDirty(true);
  }

  const recipients = (
    <>
      <RecipientFieldInput
        field="to"
        label="À (séparés par des virgules)"
        hint="Entrée, virgule ou espace valide chaque destinataire."
        chips={fields.to.chips}
        draft={fields.to.draft}
        disabled={busy}
        full={recipientTotal >= MAX_RECIPIENT_CHIPS}
        onDraftChange={(value) => patchField("to", { draft: value })}
        onCommit={({ chips, rest }) => patchField("to", { chips, draft: rest })}
        onRemove={(value) => removeChip("to", value)}
      />

      {showBcc ? (
        <RecipientFieldInput
          field="bcc"
          label="Cci"
          hint="Copie cachée : reçue sans apparaître aux autres destinataires."
          chips={fields.bcc.chips}
          draft={fields.bcc.draft}
          disabled={busy}
          full={recipientTotal >= MAX_RECIPIENT_CHIPS}
          onDraftChange={(value) => patchField("bcc", { draft: value })}
          onCommit={({ chips, rest }) => patchField("bcc", { chips, draft: rest })}
          onRemove={(value) => removeChip("bcc", value)}
        />
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          aria-expanded={showBcc}
          onClick={() => setShowBcc((current) => !current)}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          {showBcc ? "Masquer les copies cachées" : "Ajouter des copies cachées (Cci)"}
        </button>
      </div>

      <RecipientFieldInput
        field="cc"
        label="Cc"
        hint="Copie visible par tous les destinataires."
        chips={fields.cc.chips}
        draft={fields.cc.draft}
        disabled={busy}
        full={recipientTotal >= MAX_RECIPIENT_CHIPS}
        onDraftChange={(value) => patchField("cc", { draft: value })}
        onCommit={({ chips, rest }) => patchField("cc", { chips, draft: rest })}
        onRemove={(value) => removeChip("cc", value)}
      />
    </>
  );

  return (
    <Dialog
      open
      onClose={() => requestClose()}
      title={seed.id ? "Modifier le brouillon" : "Nouveau message"}
      className="max-w-2xl"
    >
      <form id="mail-composer" onSubmit={onSend} method="post" className="flex flex-col gap-3">
        {recipients}

        <div className="flex flex-col gap-1">
          <Label htmlFor="mail-subject">Objet</Label>
          <Input
            id="mail-subject"
            value={subject}
            maxLength={500}
            onChange={(event) => {
              setSubject(event.target.value);
              setDirty(true);
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="mail-body">Message</Label>
          <textarea
            id="mail-body"
            value={body}
            rows={10}
            maxLength={100000}
            onChange={(event) => {
              setBody(event.target.value);
              setDirty(true);
            }}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-soft"
          />
        </div>

        <ComposerAttachments
          attachments={attachments}
          disabled={busy}
          onPick={onPickAttachments}
          onRemove={onRemoveAttachment}
          onRetry={onRetryAttachment}
          onRetryAll={onRetryAll}
        />

        {attachments.length > 0 ? (
          <p className="text-xs text-muted-foreground">{ATTACHMENTS_DRAFT_NOTICE}</p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <span className="mr-auto text-xs text-muted-foreground" role="status">
            {autosaveLabel(autosave.state, autosave.savedAt)}
          </span>
          <Button type="button" variant="ghost" onClick={() => requestClose()} disabled={busy}>
            Fermer
          </Button>
          <Button
            type="button"
            variant="outline"
            loading={busy}
            onClick={() => void saveDraft(false)}
          >
            Enregistrer en brouillon
          </Button>
          <Button type="submit" loading={busy}>
            Envoyer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
