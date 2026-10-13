import { Alert, Button } from "@workspace/ui";
import { waitingAnnouncement } from "../lobby.ts";
import type { LobbyEntryView } from "../server.ts";

export type LobbyPanelProps = {
  entries: readonly LobbyEntryView[];
  busy: boolean;
  error: string | null;
  onAdmit: (userId: string) => void;
  onDeny: (userId: string) => void;
};

/**
 * File d'admission vue de l'organisateur : les personnes en attente, leur
 * demande, et les deux seules actions possibles — admettre ou refuser.
 */
export function LobbyPanel({ entries, busy, error, onAdmit, onDeny }: LobbyPanelProps) {
  return (
    <section
      aria-labelledby="meet-lobby-title"
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 id="meet-lobby-title" className="font-display text-sm font-semibold">
          Salle d'attente
        </h2>
        <p className="text-xs text-muted-foreground">{waitingAnnouncement(entries.length)}</p>
      </header>

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
    </section>
  );
}
