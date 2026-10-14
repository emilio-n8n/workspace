import { Badge, cn, EmptyState, IconMail, Spinner } from "@workspace/ui";
import { type ReactNode, useEffect, useRef } from "react";
import type { FolderKey, MessageLabelRef } from "../server.ts";
import { LabelChip } from "./label-chip.tsx";

/** Élément affichable dans la liste — message plat ou dernier message d'un fil. */
export type MessageListItem = {
  /** Clé de sélection : identifiant de fil ou de message. */
  key: string;
  /** Message agissé par les raccourcis (dernier du fil). */
  messageId: string;
  title: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  starred: boolean;
  /** Nombre de messages du fil, quand le regroupement est actif. */
  count?: number;
  attachmentCount: number;
  sendError: string | null;
  /** Libellés du message (ou l'union des libellés du fil). */
  labels: MessageLabelRef[];
};

/** Message d'un fil déplié (même forme, sans libellé à recharger). */
export type ExpandedMessage = {
  id: string;
  title: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  starred: boolean;
};

export type MessageListProps = {
  items: MessageListItem[];
  selectedKey: string | null;
  folder: FolderKey;
  /** Index actif — suit la sélection clavier. */
  activeIndex: number;
  /** Change à chaque déplacement au clavier : ramène le focus sur la liste. */
  focusNonce: number;
  loading: boolean;
  empty: ReactNode;
  onSelect: (item: MessageListItem, index: number) => void;
  /** Fil ouvert en déplié, ou null. */
  expandedKey: string | null;
  /** Messages du fil déplié (null pendant le chargement). */
  expandedMessages: ExpandedMessage[] | null;
  onToggleExpand: (item: MessageListItem) => void;
  /** Ouvre un message précis d'un fil déplié. */
  onExpandMessage: (messageId: string) => void;
  onStarMessage: (messageId: string) => void;
};

/**
 * Liste des messages et des conversations : une liste sémantique dont chaque
 * ligne est un bouton (ouvrir) doublé, pour les conversations, d'un bouton de
 * dépli qui révèle les messages du fil. Focus mobile — une seule ligne est
 * atteignable par Tab, les flèches et les raccourcis déplacent la sélection.
 */
export function MessageList({
  items,
  selectedKey,
  folder,
  activeIndex,
  focusNonce,
  loading,
  empty,
  onSelect,
  expandedKey,
  expandedMessages,
  onToggleExpand,
  onExpandMessage,
  onStarMessage,
}: MessageListProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Le focus suit la sélection quand elle vient du clavier : sans cela, un
  // lecteur d'écran continue d'annoncer l'ancien message.
  useEffect(() => {
    if (focusNonce === 0) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.focus();
  }, [focusNonce, activeIndex]);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-3 text-xs text-muted-foreground" role="status">
        Chargement…
      </div>
    );
  }

  if (items.length === 0) return <>{empty}</>;

  const outgoing = folder === "sent" || folder === "drafts";

  return (
    <ul
      ref={listRef}
      aria-label="Messages"
      className="flex flex-1 flex-col divide-y divide-border overflow-y-auto"
    >
      {items.map((item, index) => {
        const selected = item.key === selectedKey;
        const active = index === activeIndex;
        const expandable = item.count !== undefined && item.count > 1;
        const expanded = expandable && expandedKey === item.key;
        const panelId = `thread-panel-${item.key}`;
        return (
          <li key={item.key} className="flex flex-col">
            <div
              className={cn(
                "flex items-start gap-1 px-2 py-2 transition-colors",
                selected ? "bg-accent/60" : "hover:bg-muted",
                item.unread && "font-medium",
              )}
            >
              {expandable ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  aria-label={`${expanded ? "Replier" : "Déplier"} la conversation (${item.count} messages)`}
                  tabIndex={active ? 0 : -1}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleExpand(item);
                  }}
                  className="mt-0.5 grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden
                    className={cn("size-3 transition-transform", expanded && "rotate-90")}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                  >
                    <path d="M6 3l5 5-5 5" />
                  </svg>
                </button>
              ) : null}

              <button
                type="button"
                data-index={index}
                tabIndex={active ? 0 : -1}
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(item, index)}
                className="flex min-w-0 flex-1 flex-col gap-0.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="flex items-center gap-2">
                  {item.unread ? (
                    <span
                      role="img"
                      aria-label="Non lu"
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">
                    {outgoing ? `À : ${item.title}` : item.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{item.date}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {item.subject || "(sans objet)"}
                  </span>
                  {item.count !== undefined && item.count > 1 ? (
                    <Badge title={`${item.count} messages`}>{item.count}</Badge>
                  ) : null}
                </span>
                <span className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {item.snippet}
                  </span>
                  {item.attachmentCount > 0 ? (
                    <span
                      className="shrink-0 text-[10px] text-muted-foreground"
                      title="Pièces jointes"
                    >
                      📎 {item.attachmentCount}
                    </span>
                  ) : null}
                  {item.starred ? <span className="shrink-0 text-attention">★</span> : null}
                  {item.sendError ? (
                    <span className="shrink-0 text-[10px] text-destructive" title={item.sendError}>
                      ⚠
                    </span>
                  ) : null}
                </span>
                {item.labels.length > 0 ? (
                  <span className="flex flex-wrap items-center gap-1 pt-0.5">
                    {item.labels.map((label) => (
                      <LabelChip key={label.id} label={label} />
                    ))}
                  </span>
                ) : null}
              </button>
            </div>

            {expandable ? (
              <div id={panelId} hidden={!expanded} className="bg-muted/30">
                {expanded ? (
                  expandedMessages === null ? (
                    <Spinner className="px-9 py-2" size={12} label="Chargement du fil…" />
                  ) : expandedMessages.length === 0 ? (
                    <p className="px-9 py-2 text-xs text-muted-foreground">Fil vide.</p>
                  ) : (
                    <ul aria-label={`Messages de la conversation`} className="flex flex-col">
                      {expandedMessages.map((message) => (
                        <li
                          key={message.id}
                          className="flex items-center gap-2 border-t border-border/60 px-3 py-1.5 first:border-t-0"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {message.unread ? (
                              <span
                                role="img"
                                aria-label="Non lu"
                                className="mr-1 inline-block size-1.5 rounded-full bg-primary align-middle"
                              />
                            ) : null}
                            <button
                              type="button"
                              onClick={() => onExpandMessage(message.id)}
                              className="text-left text-foreground underline-offset-2 hover:underline"
                            >
                              {message.title}
                            </button>
                            <span className="ml-1">{message.snippet}</span>
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {message.date}
                          </span>
                          <button
                            type="button"
                            aria-label={
                              message.starred
                                ? `Ne plus suivre le message de ${message.title}`
                                : `Suivre le message de ${message.title}`
                            }
                            onClick={() => onStarMessage(message.id)}
                            className="shrink-0 rounded p-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            {message.starred ? "★" : "☆"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** État vide de la liste, illustré par l'icône du module. */
export function MessageListEmpty({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      icon={<IconMail />}
      title={title}
      hint={hint}
      action={action}
      className="flex-1 justify-center border-0 bg-transparent"
    />
  );
}
