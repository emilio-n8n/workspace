import { cn, EmptyState } from "@workspace/ui";
import { Fragment } from "react";
import type { MessageView } from "../server.ts";
import { AttachmentLinks } from "./attachment-links.tsx";
import { fmtFullDate, fmtTime } from "./format.ts";
import { IconPin } from "./icons.tsx";
import { unreadShown, unreadSplitIndex } from "./unread.ts";
import { UnreadSeparator } from "./unread-separator.tsx";

export type MessageListProps = {
  messages: MessageView[];
  /** Identifiant des messages épinglés (épingle affichée sur la ligne). */
  pinnedIds: ReadonlySet<string>;
  /** Message dont l'épingle est en cours de bascule (désactive son bouton). */
  pinPendingId: string | null;
  onTogglePin: (message: MessageView) => void;
  /** Curseur de lecture effectif — sépare les messages non lus. */
  unreadCutoff: string | null;
  /** Annonce des nouveaux messages (region aria-live). */
  announcement: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

/** Une ligne de message : auteur, heure, épingle, bulle et pièces jointes. */
function MessageRow({
  message,
  pinned,
  pinPending,
  onTogglePin,
}: {
  message: MessageView;
  pinned: boolean;
  pinPending: boolean;
  onTogglePin: (message: MessageView) => void;
}) {
  const label = pinned
    ? `Désépingler le message de ${message.authorName}`
    : `Épingler le message de ${message.authorName}`;
  return (
    <div className={cn("group flex flex-col gap-0.5", message.mine && "items-end")}>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground" title={fmtFullDate(message.createdAt)}>
          {message.authorName} · {fmtTime(message.createdAt)}
        </span>
        {pinned ? <IconPin className="size-3 text-primary" /> : null}
        <button
          type="button"
          onClick={() => onTogglePin(message)}
          disabled={pinPending}
          aria-label={label}
          title={label}
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
      <div
        className={cn(
          "flex max-w-[75%] flex-col gap-1 rounded-xl px-3 py-2 text-sm",
          message.mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        <span className="whitespace-pre-wrap break-words">{message.body}</span>
        <AttachmentLinks attachments={message.attachments} />
      </div>
    </div>
  );
}

/**
 * Fil de la conversation : séparateur de non-lus, messages, épingles. Les
 * nouveaux messages sont annoncés poliment (region aria-live) sans jamais
 * voler le focus — le lecteur d'écran les lit quand l'utilisateur est prêt.
 */
export function MessageList({
  messages,
  pinnedIds,
  pinPendingId,
  onTogglePin,
  unreadCutoff,
  announcement,
  scrollRef,
}: MessageListProps) {
  const splitIndex = unreadSplitIndex(messages, unreadCutoff);

  return (
    <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
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
            />
          </Fragment>
        ))
      )}
    </div>
  );
}
