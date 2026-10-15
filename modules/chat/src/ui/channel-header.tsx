import { Badge, Button, IconArchive, IconSearch, Menu } from "@workspace/ui";
import type { Ref } from "react";
import type { ChannelView } from "../server.ts";
import { fmtTime } from "./format.ts";
import { IconLock, IconMore, IconPin, IconUsers } from "./icons.tsx";

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
 * En-tête de la conversation : une seule rangée compacte — identité (#canal,
 * @discussion, cadenas si privé), effectif, épingles et recherche en boutons
 * fantômes ; l'archivage, action rare réservée à la personne qui a créé le
 * canal, vit dans le menu « ⋯ ». Un canal archivé le dit explicitement :
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
    <header className="flex min-w-0 flex-nowrap items-center gap-2 border-b border-border px-2 py-1.5 sm:px-3">
      <h2 className="flex min-w-0 items-center gap-1.5 font-display text-sm font-semibold">
        <span className="text-muted-foreground">{channel.kind === "channel" ? "#" : "@"}</span>
        <span className="truncate">{channel.name}</span>
        {channel.kind === "channel" && channel.visibility === "private" ? (
          <IconLock className="text-muted-foreground" />
        ) : null}
      </h2>

      {channel.archived ? (
        <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
          Archivé
        </Badge>
      ) : null}
      {channel.kind === "channel" && channel.visibility === "private" ? (
        <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
          Privé
        </Badge>
      ) : null}

      <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
        {channel.lastMessageAt
          ? `Dernier message ${fmtTime(channel.lastMessageAt)}`
          : "Aucun message"}
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          size="sm"
          variant="ghost"
          className="px-2"
          onClick={onOpenMembers}
          aria-label={`Membres du canal (${channel.memberCount})`}
          title={`Membres (${channel.memberCount})`}
        >
          <IconUsers />
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {channel.memberCount}
          </span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="px-2"
          onClick={onOpenPins}
          aria-label={pinCount > 0 ? `Épingles (${pinCount})` : "Épingles"}
          title={pinCount > 0 ? `${pinCount} épingles` : "Aucune épingle"}
        >
          <IconPin />
          {pinCount > 0 ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">{pinCount}</span>
          ) : null}
        </Button>
        <Button
          ref={searchButtonRef}
          size="sm"
          variant="ghost"
          className="px-2"
          onClick={onToggleSearch}
          aria-label="Rechercher dans le canal"
          aria-expanded={searchOpen}
          title="Rechercher dans le canal"
        >
          <IconSearch />
        </Button>
        {channel.managedByMe ? (
          <Menu
            label="Actions du canal"
            triggerIcon={<IconMore />}
            align="end"
            triggerClassName="h-8 w-8 rounded-md border-transparent bg-transparent px-0 font-normal hover:bg-muted focus-visible:ring-offset-0"
            items={
              channel.archived
                ? [
                    {
                      id: "restore",
                      label: "Désarchiver le canal",
                      icon: <IconArchive />,
                      disabled: busy,
                      onSelect: onRestore,
                    },
                  ]
                : [
                    {
                      id: "archive",
                      label: "Archiver le canal",
                      icon: <IconArchive />,
                      destructive: true,
                      disabled: busy,
                      onSelect: onArchive,
                    },
                  ]
            }
          />
        ) : null}
      </div>
    </header>
  );
}
