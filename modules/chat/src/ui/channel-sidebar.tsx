import {
  Badge,
  Button,
  cn,
  IconArchive,
  IconClose,
  IconGlobe,
  IconMail,
  Menu,
  Spinner,
} from "@workspace/ui";
import { useState } from "react";
import type { ChannelView } from "../server.ts";
import { IconLock, IconMore } from "./icons.tsx";

export type ChannelSidebarProps = {
  channels: ChannelView[];
  activeId: string | null;
  loading: boolean;
  onSelect: (channelId: string) => void;
  onCreateChannel: () => void;
  onStartDm: () => void;
  onDiscover: () => void;
  /** Ferme la barre latérale — repliée en rail, réouvrable d'un clic. */
  onClose: () => void;
};

/** Libellé d'une ligne de la barre latérale (#canal, @discussion, archivage). */
function channelLine(channel: ChannelView) {
  if (channel.kind === "dm") return `@${channel.name}`;
  return `#${channel.name}`;
}

/**
 * Barre latérale des conversations : canaux et discussions actifs d'abord, les
 * archivés dans une section repliée (l'archive sert à ranger, pas à afficher).
 * Le total de non-lus est annoncé poliment pour les lecteurs d'écran.
 */
export function ChannelSidebar({
  channels,
  activeId,
  loading,
  onSelect,
  onCreateChannel,
  onStartDm,
  onDiscover,
  onClose,
}: ChannelSidebarProps) {
  const [archivedOpen, setArchivedOpen] = useState(false);

  const active = channels.filter((channel) => !channel.archived);
  const archived = channels.filter((channel) => channel.archived);
  const unreadTotal = channels.reduce((sum, channel) => sum + channel.unreadCount, 0);

  return (
    <aside className="flex min-h-0 w-64 shrink-0 flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-0.5">
        <h1 className="min-w-0 flex-1 truncate font-display text-base font-semibold">Chat</h1>
        <Button
          size="sm"
          variant="ghost"
          className="size-8 px-0"
          aria-label="Nouveau canal"
          title="Nouveau canal"
          onClick={onCreateChannel}
        >
          ＋
        </Button>
        <Menu
          label="Plus d'actions"
          triggerIcon={<IconMore />}
          align="end"
          triggerClassName="size-8 rounded-md border-transparent bg-transparent px-0 font-normal hover:bg-muted focus-visible:ring-offset-0"
          items={[
            { id: "dm", label: "Nouvelle discussion", icon: <IconMail />, onSelect: onStartDm },
            {
              id: "discover",
              label: "Découvrir les canaux publics",
              icon: <IconGlobe />,
              onSelect: onDiscover,
            },
          ]}
        />
        <Button
          size="sm"
          variant="ghost"
          className="size-8 px-0"
          aria-label="Masquer les conversations"
          title="Masquer les conversations"
          onClick={onClose}
        >
          <IconClose />
        </Button>
      </div>

      <div aria-live="polite" className="sr-only">
        {unreadTotal > 0
          ? `${unreadTotal} message${unreadTotal > 1 ? "s" : ""} non lu${unreadTotal > 1 ? "s" : ""}`
          : "Aucun message non lu"}
      </div>

      {loading ? (
        <Spinner className="px-2 py-1" size={12} label="Chargement des salons…" />
      ) : channels.length === 0 ? (
        // Pas d'EmptyState ici : sa carte p-8 déborderait de la barre de 256 px.
        <p className="text-xs text-muted-foreground">
          Aucune conversation. Créez un canal ou démarrez une discussion.
        </p>
      ) : (
        <>
          <ul
            aria-label="Conversations"
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
          >
            {active.map((channel) => (
              <li key={channel.id}>
                <button
                  type="button"
                  onClick={() => onSelect(channel.id)}
                  aria-current={channel.id === activeId ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                    channel.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                  )}
                >
                  <span className="truncate">
                    {channel.kind === "channel" ? "#" : "@"}
                    {channel.name}
                  </span>
                  {channel.visibility === "private" ? (
                    <IconLock className="shrink-0 text-muted-foreground" />
                  ) : null}
                  {channel.unreadCount > 0 ? (
                    <Badge className="ml-auto min-w-5 justify-center">{channel.unreadCount}</Badge>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          {archived.length > 0 ? (
            <div className="mt-auto flex shrink-0 flex-col gap-1 border-t border-border pt-2">
              <button
                type="button"
                onClick={() => setArchivedOpen((open) => !open)}
                aria-expanded={archivedOpen}
                className="flex items-center gap-1.5 px-2 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <IconArchive />
                Archivés ({archived.length})
              </button>
              {archivedOpen ? (
                <ul
                  aria-label="Conversations archivées"
                  className="flex max-h-40 flex-col gap-1 overflow-y-auto"
                >
                  {archived.map((channel) => (
                    <li key={channel.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(channel.id)}
                        aria-current={channel.id === activeId ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors",
                          channel.id === activeId
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted",
                        )}
                      >
                        <IconArchive className="shrink-0" />
                        <span className="truncate">{channelLine(channel)}</span>
                        {channel.unreadCount > 0 ? (
                          <Badge className="ml-auto min-w-5 justify-center">
                            {channel.unreadCount}
                          </Badge>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}
