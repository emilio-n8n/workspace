import { Button, Dialog, EmptyState } from "@workspace/ui";
import type { PinView } from "../server.ts";
import { attachmentSummary } from "./attachment-links.tsx";
import { fmtFullDate, fmtTime } from "./format.ts";
import { IconPin } from "./icons.tsx";

export type PinsDialogProps = {
  open: boolean;
  onClose: () => void;
  channelName: string;
  pins: PinView[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onUnpin: (pin: PinView) => void;
  busy: boolean;
};

/**
 * Panneau des épingles d'une conversation — les messages que l'équipe a voulu
 * garder sous la main. Chaque épingle se désépingle sur place ; l'état vide dit
 * comment faire (survoler un message, bouton d'épingle).
 */
export function PinsDialog({
  open,
  onClose,
  channelName,
  pins,
  loading,
  error,
  onRetry,
  onUnpin,
  busy,
}: PinsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={`Épingles — ${channelName}`}>
      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement des épingles…</p>
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
      ) : pins.length === 0 ? (
        <EmptyState
          title="Aucun message épinglé"
          hint="Survolez un message puis cliquez sur l'épingle pour le garder en évidence ici."
          className="border-0 bg-transparent p-0"
        />
      ) : (
        <ul aria-label="Messages épinglés" className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {pins.map((pin) => (
            <li
              key={pin.id}
              className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <IconPin className="size-3 text-primary" />
                <span className="font-medium text-foreground">{pin.authorName}</span>
                <span title={fmtFullDate(pin.createdAt)}>{fmtTime(pin.createdAt)}</span>
                <span className="ml-auto truncate">épinglé par {pin.pinnedByName}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">{pin.body}</p>
              {attachmentSummary(pin.attachments) ? (
                <p className="text-xs text-muted-foreground">
                  {attachmentSummary(pin.attachments)}
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onUnpin(pin)}
                  aria-label={`Désépingler le message de ${pin.authorName}`}
                >
                  Désépingler
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
