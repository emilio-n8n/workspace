import { Badge, cn, EmptyState, IconMail } from "@workspace/ui";
import { type ReactNode, useEffect, useRef } from "react";
import type { FolderKey } from "../server.ts";

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
};

/**
 * Liste des messages (ou des conversations) : rôle `listbox` dont les options
 * portent `aria-selected`, et focus mobile — une seule ligne est atteignable
 * par Tab, les flèches et les raccourcis déplacent la sélection sans piège.
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
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Messages"
      className="flex flex-1 flex-col divide-y divide-border overflow-y-auto"
    >
      {items.map((item, index) => {
        const selected = item.key === selectedKey;
        const outgoing = folder === "sent" || folder === "drafts";
        return (
          <div
            key={item.key}
            id={`mail-item-${index}`}
            data-index={index}
            role="option"
            aria-selected={selected}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onSelect(item, index)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(item, index);
              }
            }}
            className={cn(
              "flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              selected ? "bg-accent/60" : "hover:bg-muted",
              item.unread && "font-medium",
            )}
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
              {item.count !== undefined && item.count > 1 ? <Badge>{item.count}</Badge> : null}
            </span>
            <span className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {item.snippet}
              </span>
              {item.attachmentCount > 0 ? (
                <span className="shrink-0 text-[10px] text-muted-foreground" title="Pièces jointes">
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
          </div>
        );
      })}
    </div>
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
