import { Alert, Button, Sheet } from "@workspace/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  CHAT_MAX_LENGTH,
  chatBodyLength,
  formatMessageTime,
  unreadLabel,
  validateChatBody,
} from "../chat.ts";
import type { ChatMessageView } from "../server.ts";

export type ChatPanelProps = {
  open: boolean;
  onClose: () => void;
  messages: readonly ChatMessageView[];
  unread: number;
  error: string | null;
  /** Un envoi est en cours. */
  busy: boolean;
  onSend: (body: string) => Promise<boolean>;
};

/**
 * Panneau latéral du chat de réunion — portée salle uniquement (les messages ne
 * quittent jamais la réunion et ne sont jamais audités). La liste est un journal
 * vivant (`role="log"`) : chaque message reçu y est annoncé aux lecteurs
 * d'écran, et le compteur de non lus remonte dans l'en-tête.
 */
export function ChatPanel({
  open,
  onClose,
  messages,
  unread,
  error,
  busy,
  onSend,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // À l'ouverture comme à chaque nouveau message, on garde le dernier visible
  // (`messages` n'est pas lu : le défilement suit simplement chaque rendu).
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateChatBody(draft);
    if (!validation.ok) {
      setDraftError(validation.error);
      return;
    }
    setDraftError(null);
    const sent = await onSend(validation.body);
    if (sent) setDraft("");
  }

  const length = chatBodyLength(draft);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="right"
      title="Chat de la réunion"
      description={unreadLabel(unread)}
    >
      <div className="flex h-full flex-col gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {/*
          Journal vivant : les messages reçus sont annoncés aux lecteurs d'écran
          (seules les additions, jamais le rechargement complet).
        */}
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Messages de la réunion"
          className="min-h-0 flex-1 overflow-y-auto pr-1"
        >
          <ol ref={listRef} className="flex flex-col gap-3">
            {messages.length === 0 ? (
              <li className="text-sm text-muted-foreground">
                Aucun message pour le moment. Écrivez le premier.
              </li>
            ) : (
              messages.map((message) => (
                <li key={message.id} className="flex flex-col gap-0.5">
                  <p className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {message.own ? "Vous" : message.userName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatMessageTime(message.createdAt)}
                    </span>
                  </p>
                  <p
                    className={
                      message.own
                        ? "rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground"
                        : "rounded-lg border border-border px-3 py-1.5 text-sm text-foreground"
                    }
                  >
                    {message.body}
                  </p>
                </li>
              ))
            )}
          </ol>
        </div>

        <form className="flex flex-col gap-1 border-t border-border pt-3" onSubmit={submit}>
          <label className="sr-only" htmlFor="meet-chat-message">
            Votre message
          </label>
          <textarea
            id="meet-chat-message"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (draftError) setDraftError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            maxLength={CHAT_MAX_LENGTH}
            placeholder="Écrire un message… (Entrée pour envoyer)"
            aria-invalid={draftError !== null || undefined}
            aria-describedby="meet-chat-counter"
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {draftError ? (
            <p role="alert" className="text-xs text-destructive">
              {draftError}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span id="meet-chat-counter" className="text-xs text-muted-foreground tabular-nums">
              {length} / {CHAT_MAX_LENGTH}
            </span>
            <Button type="submit" size="sm" loading={busy} disabled={draft.trim().length === 0}>
              Envoyer
            </Button>
          </div>
        </form>
      </div>
    </Sheet>
  );
}
