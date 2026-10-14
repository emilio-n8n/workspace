import { Alert, Badge, Button, Sheet } from "@workspace/ui";
import {
  moderateMicrophoneLabel,
  mutedByHostLabel,
  orderParticipants,
  participantsCountLabel,
  raisedHandLabel,
  raisedHandQueue,
  raisedHandsCountLabel,
  raiseHandLabel,
  roleActionLabel,
  roleLabel,
} from "../participants.ts";
import type { ParticipantView, RosterView } from "../server.ts";

export type ParticipantsPanelProps = {
  open: boolean;
  onClose: () => void;
  roster: RosterView | null;
  loading: boolean;
  error: string | null;
  /** Une action de modération est en cours. */
  busy: boolean;
  onMute: (participant: ParticipantView, muted: boolean) => void;
  onRemove: (participant: ParticipantView) => void;
  onLowerHand: (participant: ParticipantView) => void;
  onSetRole: (participant: ParticipantView, role: "moderator" | "participant") => void;
};

/**
 * Panneau latéral des participants — effectif, rôles et mains levées, avec les
 * actions de modération réservées à l'organisateur et aux animateurs. La file
 * des mains est dans l'ordre de levée : c'est l'ordre dans lequel on donne la
 * parole.
 */
export function ParticipantsPanel({
  open,
  onClose,
  roster,
  loading,
  error,
  busy,
  onMute,
  onRemove,
  onLowerHand,
  onSetRole,
}: ParticipantsPanelProps) {
  const participants = roster ? orderParticipants(roster.participants) : [];
  const hands = roster ? raisedHandQueue(roster.participants) : [];
  const me = roster?.self ?? null;
  const canModerate = roster?.canModerate ?? false;
  const isCreator = me?.role === "host";

  /** Le créateur ne se modère pas lui-même, et personne ne modère l'organisateur. */
  const canActOn = (participant: ParticipantView) =>
    canModerate && !participant.self && participant.role !== "host";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="right"
      title="Participants"
      description={roster ? participantsCountLabel(roster.count) : undefined}
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {loading && !roster ? (
          <p className="text-sm text-muted-foreground">Chargement des participants…</p>
        ) : null}

        <section aria-labelledby="meet-hands-title" className="flex flex-col gap-2">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="meet-hands-title" className="font-display text-sm font-semibold">
              Mains levées
            </h3>
            <p className="text-xs text-muted-foreground">{raisedHandsCountLabel(hands.length)}</p>
          </header>

          {hands.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Personne n'a la main levée pour le moment.
            </p>
          ) : (
            <ol aria-label="File des mains levées" className="flex flex-col gap-1">
              {hands.map((participant, position) => (
                <li
                  key={participant.userId}
                  className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {position + 1}.
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {participant.self ? "Vous" : participant.name}
                  </span>
                  <Badge variant="outline">{raisedHandLabel()}</Badge>
                  {canActOn(participant) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy}
                      onClick={() => onLowerHand(participant)}
                    >
                      {raiseHandLabel(true)}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="meet-roster-title" className="flex flex-col gap-2">
          <h3 id="meet-roster-title" className="font-display text-sm font-semibold">
            Dans la salle
          </h3>

          <ul aria-label="Participants de la réunion" className="flex flex-col gap-1">
            {participants.map((participant) => (
              <li
                key={participant.userId}
                className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {participant.self ? `${participant.name} (vous)` : participant.name}
                </span>
                <Badge variant={participant.role === "host" ? "accent" : "outline"}>
                  {roleLabel({ ...participant, self: false })}
                </Badge>
                {participant.handRaised ? (
                  <Badge variant="outline">{raisedHandLabel()}</Badge>
                ) : null}
                {participant.mutedByHost ? (
                  <Badge variant="destructive">{mutedByHostLabel()}</Badge>
                ) : null}

                {canActOn(participant) ? (
                  <span className="flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy}
                      onClick={() => onMute(participant, !participant.mutedByHost)}
                    >
                      {moderateMicrophoneLabel(participant)}
                    </Button>
                    {isCreator ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy}
                        onClick={() =>
                          onSetRole(
                            participant,
                            participant.role === "moderator" ? "participant" : "moderator",
                          )
                        }
                      >
                        {roleActionLabel(participant.role)}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      loading={busy}
                      onClick={() => onRemove(participant)}
                    >
                      Retirer
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          {participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">Personne d'autre dans la salle.</p>
          ) : null}
        </section>

        {!canModerate ? (
          <p className="text-xs text-muted-foreground">
            Seuls l'organisateur et les animateurs peuvent couper un micro ou retirer une personne.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
