import { Button, Dialog, EmptyState } from "@workspace/ui";
import type { JoinableChannelView } from "../server.ts";
import { fmtTime } from "./format.ts";

export type DiscoverDialogProps = {
  open: boolean;
  onClose: () => void;
  channels: JoinableChannelView[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onJoin: (channelId: string) => void;
  busy: boolean;
};

/**
 * Découverte des canaux publics de l'organisation : ce qui distingue un canal
 * public (n'importe qui peut entrer) d'un canal privé (sur invitation). Les
 * canaux privés n'apparaissent jamais ici — pas même sous une forme masquée.
 */
export function DiscoverDialog({
  open,
  onClose,
  channels,
  loading,
  error,
  onRetry,
  onJoin,
  busy,
}: DiscoverDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Découvrir les canaux publics">
      {loading ? (
        <p className="text-sm text-muted-foreground">Recherche des canaux…</p>
      ) : error ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <div>
            <Button type="button" variant="ghost" onClick={onRetry}>
              Réessayer
            </Button>
          </div>
        </div>
      ) : channels.length === 0 ? (
        <EmptyState
          title="Aucun canal public à rejoindre"
          hint="Vous êtes déjà dans tous les canaux publics de l'organisation. Les canaux privés, eux, se rejoignent sur invitation."
          className="border-0 bg-transparent p-0"
        />
      ) : (
        <ul aria-label="Canaux publics à rejoindre" className="flex flex-col gap-1">
          {channels.map((channel) => (
            <li
              key={channel.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
            >
              <span className="truncate font-medium">#{channel.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {channel.memberCount} membre{channel.memberCount > 1 ? "s" : ""}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {channel.lastMessageAt ? fmtTime(channel.lastMessageAt) : "aucun message"}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onJoin(channel.id)}
                aria-label={`Rejoindre le canal ${channel.name}`}
              >
                Rejoindre
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
