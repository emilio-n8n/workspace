import { cn, EmptyState } from "@workspace/ui";
import { Fragment, useMemo } from "react";
import type { MessageView } from "../server.ts";
import { AttachmentLinks } from "./attachment-links.tsx";
import { fmtFullDate, fmtTime } from "./format.ts";
import { IconPin } from "./icons.tsx";
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

/** Une ligne de message : auteur, heure, épingle, bulle et pièces jointes. */
function MessageRow({
  message,
  pinned,
  pinPending,
  onTogglePin,
  slot,
  activeMatchIndex,
}: {
  message: MessageView;
  pinned: boolean;
  pinPending: boolean;
  onTogglePin: (message: MessageView) => void;
  /** Correspondances de la recherche dans ce message. */
  slot: MatchSlot | undefined;
  activeMatchIndex: number | null;
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
    </div>
  );
}

/**
 * Fil de la conversation : séparateur de non-lus, mentions en puces,
 * surlignage de la recherche. Les nouveaux messages sont annoncés poliment
 * (region aria-live) sans jamais voler le focus — le lecteur d'écran les lit
 * quand l'utilisateur est prêt.
 */
export function MessageList({
  messages,
  pinnedIds,
  pinPendingId,
  onTogglePin,
  unreadCutoff,
  announcement,
  searchRanges,
  activeMatchIndex = null,
  scrollRef,
}: MessageListProps) {
  const splitIndex = unreadSplitIndex(messages, unreadCutoff);

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
              slot={slots.get(message.id)}
              activeMatchIndex={activeMatchIndex}
            />
          </Fragment>
        ))
      )}
    </div>
  );
}
