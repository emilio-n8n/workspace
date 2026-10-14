import { Badge, Button, IconArchive, IconSearch } from "@workspace/ui";
import type { Ref } from "react";
import type { ChannelView } from "../server.ts";
import { fmtTime } from "./format.ts";
import { IconLock, IconPin, IconUsers } from "./icons.tsx";

export type ChannelHeaderProps = {
  channel: ChannelView;
  /** Nombre d'épingles en cours dans la conversation. */
  pinCount: number;
  onOpenPins: () => void;
  onOpenMembers: () => void;
  onArchive: () => void;
  onRestore: () => void;
  /** Ouverture / fermeture de la recherche du canal. */
  searchOpen: boolean;
  onToggleSearch: () => void;
  /** Focus rendu au bouton de recherche à la fermeture. */
  searchButtonRef?: Ref<HTMLButtonElement>;
  busy: boolean;
};

/**
 * En-tête de la conversation : identité (#canal, @discussion, cadenas si
 * privé), effectif, épingles, dernier message — et archivage réservé à la
 * personne qui a créé le canal. Un canal archivé le dit explicitement :
 * l'interface ne laisse jamais deviner pourquoi le compositeur a disparu.
 */
export function ChannelHeader({
  channel,
  pinCount,
  onOpenPins,
  onOpenMembers,
  onArchive,
  onRestore,
  searchOpen,
  onToggleSearch,
  searchButtonRef,
  busy,
}: ChannelHeaderProps) {
  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-3">
      <h2 className="flex min-w-0 items-center gap-1.5 font-display text-sm font-semibold">
        <span className="text-muted-foreground">{channel.kind === "channel" ? "#" : "@"}</span>
        <span className="truncate">{channel.name}</span>
        {channel.kind === "channel" && channel.visibility === "private" ? (
          <IconLock className="text-muted-foreground" />
        ) : null}
      </h2>

      {channel.archived ? <Badge variant="outline">Archivé</Badge> : null}
      {channel.kind === "channel" && channel.visibility === "private" ? (
        <Badge variant="outline">Privé</Badge>
      ) : null}

      <span className="text-xs text-muted-foreground">
        {channel.lastMessageAt
          ? `Dernier message ${fmtTime(channel.lastMessageAt)}`
          : "Aucun message"}
      </span>

      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={onOpenMembers}
          aria-label={`Membres du canal (${channel.memberCount})`}
          title={`Membres (${channel.memberCount})`}
        >
          <IconUsers />
          <span className="text-xs text-muted-foreground">{channel.memberCount}</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onOpenPins}
          aria-label={pinCount > 0 ? `Épingles (${pinCount})` : "Épingles"}
          title={pinCount > 0 ? `${pinCount} épingles` : "Aucune épingle"}
        >
          <IconPin />
          {pinCount > 0 ? <span className="text-xs text-muted-foreground">{pinCount}</span> : null}
        </Button>
        <Button
          ref={searchButtonRef}
          size="sm"
          variant="ghost"
          onClick={onToggleSearch}
          aria-label="Rechercher dans le canal"
          aria-expanded={searchOpen}
          title="Rechercher dans le canal"
        >
          <IconSearch />
        </Button>
        {channel.managedByMe ? (
          channel.archived ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRestore}
              loading={busy}
              aria-label="Désarchiver le canal"
              title="Désarchiver le canal"
            >
              <IconArchive />
              <span className="text-xs">Désarchiver</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={onArchive}
              loading={busy}
              className="text-destructive"
              aria-label="Archiver le canal"
              title="Archiver le canal"
            >
              <IconArchive />
              <span className="text-xs">Archiver</span>
            </Button>
          )
        ) : null}
      </div>
    </header>
  );
}
