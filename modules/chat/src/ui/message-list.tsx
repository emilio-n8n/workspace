// biome-ignore-all lint/a11y/noStaticElementInteractions: éléments interactifs stylés ; le rôle et le clavier sont posés explicitement à côté.
import { Button, cn, EmptyState } from "@workspace/ui";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { MessageView } from "../server.ts";
import { AttachmentLinks } from "./attachment-links.tsx";
import { fmtFullDate, fmtTime } from "./format.ts";
import { IconPen, IconPin } from "./icons.tsx";
import { MessageBody } from "./message-body.tsx";
import type { MatchRange } from "./search.ts";
import { unreadShown, unreadSplitIndex } from "./unread.ts";
import { UnreadSeparator } from "./unread-separator.tsx";

export type MessageListProps = {
  messages: MessageView[];
  /** Identifiants des messages épinglés (épingle affichée sur la ligne). */
  pinnedIds: ReadonlySet<string>;
  /** Message dont l'épingle est en cours de bascule (désactive son bouton). */
  pinPendingId: string | null;
  onTogglePin: (message: MessageView) => void;
  /** Édition en place d'un message — l'auteur seul y accède. La promesse
   *  rejetée garde l'édition ouverte (le brouillon n'est pas perdu). */
  onEdit: (message: MessageView, body: string) => Promise<void>;
  /** Curseur de lecture effectif — sépare les messages non lus. */
  unreadCutoff: string | null;
  /** Annonce des nouveaux messages (region aria-live). */
  announcement: string;
  /** Bornes des correspondances de la recherche, par message. */
  searchRanges?: ReadonlyMap<string, MatchRange[]>;
  /** Index global de la correspondance active (navigation dans les résultats). */
  activeMatchIndex?: number | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

/** Correspondances d'un message et rang de sa première (doublure légère du corps). */
type MatchSlot = { ranges: MatchRange[]; firstIndex: number };

/**
 * Une ligne de message : auteur, heure, épingle, bulle et pièces jointes.
 * Les messages de l'auteur s'éditent en place (bouton crayon ou double-clic) :
 * taper remplace le texte dans la bulle, Entrée enregistre, Échap annule.
 */
function MessageRow({
  message,
  pinned,
  pinPending,
  onTogglePin,
  slot,
  activeMatchIndex,
  editing,
  draft,
  onDraftChange,
  onStartEdit,
  onSubmitEdit,
  onCancelEdit,
}: {
  message: MessageView;
  pinned: boolean;
  pinPending: boolean;
  onTogglePin: (message: MessageView) => void;
  /** Correspondances de la recherche dans ce message. */
  slot: MatchSlot | undefined;
  activeMatchIndex: number | null;
  /** Vrai quand ce message est édité en place. */
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onSubmitEdit: () => void;
  onCancelEdit: () => void;
}) {
  const pinLabel = pinned
    ? `Désépingler le message de ${message.authorName}`
    : `Épingler le message de ${message.authorName}`;
  return (
    <div className={cn("group flex flex-col gap-0.5", message.mine && "items-end")}>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground" title={fmtFullDate(message.createdAt)}>
          {message.authorName} · {fmtTime(message.createdAt)}
        </span>
        {pinned ? <IconPin className="size-3 text-primary" /> : null}
        {message.mine ? (
          <button
            type="button"
            onClick={onStartEdit}
            disabled={pinPending || editing}
            aria-label={`Modifier le message de ${message.authorName}`}
            title="Modifier le message"
            className={cn(
              "rounded p-0.5 text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "opacity-0 group-hover:opacity-100 focus-visible:ring-offset-1",
            )}
          >
            <IconPen className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onTogglePin(message)}
          disabled={pinPending || editing}
          aria-label={pinLabel}
          title={pinLabel}
          aria-pressed={pinned}
          className={cn(
            "rounded p-0.5 text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "opacity-0 group-hover:opacity-100 focus-visible:ring-offset-1",
            pinned && "opacity-100 text-primary",
          )}
        >
          <IconPin className="size-3.5" />
        </button>
      </div>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitEdit();
          }}
          className="flex w-full max-w-[75%] flex-col gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm text-foreground"
        >
          <textarea
            aria-label="Modifier le message"
            value={draft}
            // biome-ignore lint/a11y/noAutofocus: l'édition en place commence par le champ.
            autoFocus
            rows={2}
            maxLength={4000}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancelEdit();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSubmitEdit();
              }
            }}
            className="max-h-32 min-h-9 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
          <div className="flex items-center justify-end gap-1">
            <span className="mr-auto text-[11px] text-muted-foreground">
              Entrée pour enregistrer, Échap pour annuler
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={onCancelEdit}>
              Annuler
            </Button>
            <Button type="submit" size="sm" disabled={draft.trim().length === 0}>
              Enregistrer
            </Button>
          </div>
        </form>
      ) : (
        <div
          onDoubleClick={message.mine ? onStartEdit : undefined}
          className={cn(
            "flex max-w-[75%] flex-col gap-1 rounded-xl px-3 py-2 text-sm",
            message.mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          )}
        >
          <span className="whitespace-pre-wrap break-words">
            <MessageBody
              body={message.body}
              ranges={slot?.ranges}
              activeMatchIndex={activeMatchIndex}
              firstMatchIndex={slot?.firstIndex ?? 0}
            />
          </span>
          <AttachmentLinks attachments={message.attachments} />
        </div>
      )}
    </div>
  );
}

/**
 * Fil de la conversation : séparateur de non-lus, mentions en puces,
 * surlignage de la recherche, édition en place de ses propres messages. Les
 * nouveaux messages sont annoncés poliment (region aria-live) sans jamais
 * voler le focus — le lecteur d'écran les lit quand l'utilisateur est prêt.
 */
export function MessageList({
  messages,
  pinnedIds,
  pinPendingId,
  onTogglePin,
  onEdit,
  unreadCutoff,
  announcement,
  searchRanges,
  activeMatchIndex = null,
  scrollRef,
}: MessageListProps) {
  const splitIndex = unreadSplitIndex(messages, unreadCutoff);
  /** Message édité en place (identifiant) et brouillon de la bulle. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** Enregistrement en vol : les doubles validations sont ignorées. */
  const savingRef = useRef(false);

  // Le message édité peut quitter le fil (recherche, changement de canal) :
  // l'édition en place s'arrête au lieu de viser une ligne absente.
  useEffect(() => {
    if (editingId && !messages.some((message) => message.id === editingId)) {
      setEditingId(null);
    }
  }, [editingId, messages]);

  function startEdit(message: MessageView) {
    setEditingId(message.id);
    setDraft(message.body);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function submitEdit() {
    if (savingRef.current) return;
    const message = messages.find((row) => row.id === editingId);
    const body = draft.trim();
    if (!message || body.length === 0 || body === message.body) {
      setEditingId(null);
      return;
    }
    savingRef.current = true;
    try {
      await onEdit(message, body);
      setEditingId(null);
    } catch {
      // L'erreur est déjà signalée à l'appelant : l'édition reste ouverte.
    } finally {
      savingRef.current = false;
    }
  }

  /**
   * Rang global de chaque correspondance, dans l'ordre du fil : c'est ce qui
   * permet au compteur « 3 / 12 » et à la navigation de désigner la même
   * occurrence que celle qui est surlignée.
   */
  const slots = useMemo(() => {
    const map = new Map<string, MatchSlot>();
    let running = 0;
    for (const message of messages) {
      const ranges = searchRanges?.get(message.id);
      if (!ranges || ranges.length === 0) continue;
      map.set(message.id, { ranges, firstIndex: running });
      running += ranges.length;
    }
    return map;
  }, [messages, searchRanges]);

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {messages.length === 0 ? (
        <EmptyState title="Aucun message pour le moment — lancez la conversation." />
      ) : (
        messages.map((message, index) => (
          <Fragment key={message.id}>
            {index === splitIndex ? (
              <UnreadSeparator count={unreadShown(messages, splitIndex)} />
            ) : null}
            <MessageRow
              message={message}
              pinned={pinnedIds.has(message.id)}
              pinPending={pinPendingId === message.id}
              onTogglePin={onTogglePin}
              slot={slots.get(message.id)}
              activeMatchIndex={activeMatchIndex}
              editing={editingId === message.id}
              draft={draft}
              onDraftChange={setDraft}
              onStartEdit={() => startEdit(message)}
              onSubmitEdit={submitEdit}
              onCancelEdit={cancelEdit}
            />
          </Fragment>
        ))
      )}
    </div>
  );
}
