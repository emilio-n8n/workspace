import { Button, cn } from "@workspace/ui";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AttachmentToken } from "../server.ts";
import { notifyTypingFn, uploadChatAttachmentFn } from "../server.ts";
import { fmtSize } from "./format.ts";
import {
  applyMention,
  detectMentionToken,
  type MentionCandidate,
  type MentionToken,
  rankMentionCandidates,
} from "./mentions.ts";

/** Bornes du compositeur, alignées sur le serveur : 5 fichiers de 10 Mo. */
const COMPOSER_MAX_ATTACHMENTS = 5;
const COMPOSER_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Un signal de frappe toutes les 2 s ; le bus efface au-delà de 5 s (TTL). */
const TYPING_PUBLISH_MS = 2000;

/** Lit un fichier local en base64 (sans préfixe data:) pour le serveur. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Lecture de « ${file.name} » impossible.`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) {
        reject(new Error(`Lecture de « ${file.name} » impossible.`));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export type ComposerProps = {
  channelId: string | null;
  channelName: string;
  /** Membres de la conversation — source de l'autocomplétion des mentions. */
  members: readonly MentionCandidate[];
  onSend: (body: string, attachments: AttachmentToken[]) => void;
  busy: boolean;
  /** Annonce d'une mention insérée (region aria-live). */
  onMention: (name: string) => void;
  /** Message d'information (bornes dépassées, envoi refusé). */
  onNotice: (message: string) => void;
};

/**
 * Compositeur : message, pièces jointes, autocomplétion des @mentions et
 * indicateur de frappe.
 *
 * L'autocomplétion suit le motif ARIA « combobox à liste » : le focus reste
 * dans la zone de texte, l'option active est portée par
 * `aria-activedescendant`, Entrée insère la mention (elle n'envoie pas le
 * message) et Échap ferme la liste sans rien insérer.
 */
export function Composer({
  channelId,
  channelName,
  members,
  onSend,
  busy,
  onMention,
  onNotice,
}: ComposerProps) {
  const [input, setInput] = useState("");
  /** Jetons d'upload en attente de rattachement à l'envoi. */
  const [attachments, setAttachments] = useState<AttachmentToken[]>([]);
  const [uploading, setUploading] = useState(false);
  /** Mention en cours de frappe (`null` = liste fermée). */
  const [token, setToken] = useState<MentionToken | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Curseur à replacer après insertion d'une mention. */
  const pendingCaretRef = useRef<number | null>(null);
  /** Horodatage du dernier signal de frappe émis (anti-flot côté client). */
  const lastPublishRef = useRef(0);

  const listId = "chat-mention-listbox";

  const candidates = useMemo(
    () => (token ? rankMentionCandidates(members, token.query) : []),
    [members, token],
  );
  const mentionOpen = token !== null && candidates.length > 0;

  // Le curseur est replacé après que React a mis le texte à jour.
  // biome-ignore lint/correctness/useExhaustiveDependencies: l'effet doit courir à chaque nouveau texte.
  useEffect(() => {
    const node = textareaRef.current;
    const caret = pendingCaretRef.current;
    if (!node || caret === null) return;
    pendingCaretRef.current = null;
    node.setSelectionRange(caret, caret);
  }, [input]);

  const publishTyping = useCallback(
    (typing: boolean) => {
      if (!channelId) return;
      if (!typing) {
        lastPublishRef.current = 0;
        void notifyTypingFn({ data: { channelId, typing: false } }).catch(() => undefined);
        return;
      }
      const now = Date.now();
      if (now - lastPublishRef.current < TYPING_PUBLISH_MS) return;
      lastPublishRef.current = now;
      void notifyTypingFn({ data: { channelId, typing: true } }).catch(() => undefined);
    },
    [channelId],
  );

  // Signal de frappe tant que l'utilisateur écrit, à intervalle régulier.
  useEffect(() => {
    if (input.trim().length === 0) return;
    publishTyping(true);
    const timer = window.setInterval(() => publishTyping(true), TYPING_PUBLISH_MS);
    return () => window.clearInterval(timer);
  }, [input, publishTyping]);

  // Arrêt du signal au départ du canal (et au démontage du compositeur).
  useEffect(() => () => publishTyping(false), [publishTyping]);

  // Changement de conversation : rien ne suit d'un canal à l'autre — ni le
  // brouillon, ni un jeton téléversé, ni une liste de suggestions.
  // biome-ignore lint/correctness/useExhaustiveDependencies: remise à zéro à chaque changement de canal.
  useEffect(() => {
    setInput("");
    setToken(null);
    setActiveIndex(0);
    setAttachments([]);
    publishTyping(false);
  }, [channelId, publishTyping]);

  /** Réévalue la mention sous le curseur (frappe, flèches, clic). */
  function syncMention(text: string, caret: number) {
    setToken(detectMentionToken(text, caret));
    setActiveIndex(0);
  }

  function commitMention(index: number) {
    const candidate = candidates[index];
    if (!candidate || !token) return;
    const next = applyMention(input, token, candidate.name);
    setInput(next.text);
    setToken(null);
    setActiveIndex(0);
    pendingCaretRef.current = next.caret;
    onMention(candidate.name);
    textareaRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % candidates.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + candidates.length) % candidates.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        // Entrée insère la mention : l'envoi du message attend une seconde fois.
        event.preventDefault();
        commitMention(activeIndex);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setToken(null);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    // Composition IME (accents, langues CJK) : Entrée valide la composition.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  /**
   * Téléverse les fichiers choisis un par un (jetons provisoires), avec les
   * bornes du serveur appliquées côté client : 5 fichiers, 10 Mo chacun.
   */
  async function onPickAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;

    const remaining = COMPOSER_MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      onNotice(`${COMPOSER_MAX_ATTACHMENTS} pièces jointes au maximum.`);
      return;
    }
    const accepted = files.slice(0, remaining);
    if (accepted.length < files.length) {
      onNotice(
        `${COMPOSER_MAX_ATTACHMENTS} pièces jointes au maximum — ${accepted.length} fichier(s) retenu(s) sur ${files.length}.`,
      );
    }

    setUploading(true);
    try {
      for (const file of accepted) {
        if (file.size > COMPOSER_MAX_ATTACHMENT_BYTES) {
          onNotice(`« ${file.name} » dépasse 10 Mo.`);
          continue;
        }
        try {
          const contentBase64 = await fileToBase64(file);
          const uploaded = await uploadChatAttachmentFn({
            data: {
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              contentBase64,
            },
          });
          setAttachments((current) => [...current, uploaded]);
        } catch (caught) {
          onNotice(
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

  function removeAttachment(storageKey: string) {
    setAttachments((current) => current.filter((token) => token.storageKey !== storageKey));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = input.trim();
    if (body.length === 0 || busy || uploading) return;
    publishTyping(false);
    setInput("");
    setToken(null);
    setAttachments([]);
    onSend(body, attachments);
  }

  return (
    <form
      onSubmit={onSubmit}
      method="post"
      className="flex flex-col gap-2 border-t border-border p-3"
    >
      {mentionOpen ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Membres à mentionner"
          className="flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lift"
        >
          {candidates.map((candidate, index) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: la navigation clavier est portée par la zone de texte, qui garde le focus.
            <div
              key={candidate.id}
              id={`${listId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitMention(index)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                index === activeIndex ? "bg-accent text-accent-foreground" : undefined,
              )}
            >
              <span className="truncate font-medium">{candidate.name}</span>
              <span className="truncate text-xs text-muted-foreground">{candidate.email}</span>
            </div>
          ))}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <ul aria-label="Pièces jointes en attente" className="flex flex-wrap gap-1">
          {attachments.map((attachment) => (
            <li
              key={attachment.storageKey}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
            >
              <span className="max-w-52 truncate" title={attachment.filename}>
                {attachment.filename}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {fmtSize(attachment.sizeBytes)}
              </span>
              <button
                type="button"
                aria-label={`Retirer ${attachment.filename}`}
                onClick={() => removeAttachment(attachment.storageKey)}
                className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Pièces jointes"
          title={`Pièces jointes (${COMPOSER_MAX_ATTACHMENTS} max, 10 Mo chacune)`}
          disabled={uploading || busy || attachments.length >= COMPOSER_MAX_ATTACHMENTS}
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          aria-label="Pièces jointes"
          className="hidden"
          onChange={(event) => void onPickAttachments(event)}
        />
        <textarea
          ref={textareaRef}
          aria-label="Message"
          role="combobox"
          aria-expanded={mentionOpen}
          aria-controls={mentionOpen ? listId : undefined}
          aria-activedescendant={mentionOpen ? `${listId}-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-describedby="chat-composer-hint"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            syncMention(
              event.target.value,
              event.target.selectionStart ?? event.target.value.length,
            );
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(event) => {
            // Flèches et clic ne déclenchent pas onChange : le jeton est recalculé.
            syncMention(event.currentTarget.value, event.currentTarget.selectionStart ?? 0);
          }}
          onClick={(event) =>
            syncMention(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)
          }
          rows={1}
          maxLength={4000}
          placeholder={`Écrire dans #${channelName}… (Entrée pour envoyer, @ pour mentionner)`}
          className="max-h-32 min-h-9 flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <Button type="submit" loading={busy} disabled={input.trim().length === 0 || uploading}>
          Envoyer
        </Button>
      </div>
      <p id="chat-composer-hint" className="sr-only">
        Tapez arobase pour mentionner un membre : flèches haut et bas pour choisir, Entrée pour
        insérer la mention, Échap pour fermer la liste.
      </p>
    </form>
  );
}
