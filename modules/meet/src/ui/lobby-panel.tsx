import { Alert, Button, Sheet } from "@workspace/ui";
import { waitingAnnouncement } from "../lobby.ts";
import type { LobbyEntryView } from "../server.ts";

export type LobbyPanelProps = {
  open: boolean;
  onClose: () => void;
  entries: readonly LobbyEntryView[];
  busy: boolean;
  error: string | null;
  onAdmit: (userId: string) => void;
  onDeny: (userId: string) => void;
};

/**
 * File d'admission vue de l'organisateur — volet fermable (croix, Échap) ouvert
 * depuis la barre d'appel quand quelqu'un attend : les personnes en attente,
 * leur demande, et les deux seules actions possibles — admettre ou refuser.
 */
export function LobbyPanel({
  open,
  onClose,
  entries,
  busy,
  error,
  onAdmit,
  onDeny,
}: LobbyPanelProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="right"
      title="Salle d'attente"
      description={waitingAnnouncement(entries.length)}
    >
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Personne n'attend. Les personnes qui demandent à entrer apparaîtront ici.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{entry.userName}</p>
                <Button size="sm" loading={busy} onClick={() => onAdmit(entry.userId)}>
                  Admettre
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  loading={busy}
                  onClick={() => onDeny(entry.userId)}
                >
                  Refuser
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
