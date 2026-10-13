import { Badge, Button, Dialog } from "@workspace/ui";
import type { EventView } from "../server.ts";
import { ATTENDANCE_LABELS, formatEventRange, RECURRENCE_LABELS } from "./event-labels.ts";

export type EventDetailDialogProps = {
  /** `null` = dialogue fermé. */
  event: EventView | null;
  busy: boolean;
  onClose: () => void;
  onEdit: (event: EventView) => void;
  onDelete: (event: EventView) => void;
  onRespond: (status: "accepted" | "declined") => void;
};

/**
 * Détail d'un événement : agenda, récurrence, réponse de l'invité, lieu,
 * description, liste des invités et actions (accepter, refuser, modifier,
 * supprimer).
 */
export function EventDetailDialog({
  event,
  busy,
  onClose,
  onEdit,
  onDelete,
  onRespond,
}: EventDetailDialogProps) {
  return (
    <Dialog open={event !== null} onClose={onClose} title={event?.title ?? "Événement"}>
      {event ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{event.calendarName}</Badge>
            {event.recurring ? (
              <Badge variant="outline">↻ {RECURRENCE_LABELS[event.recurrence]}</Badge>
            ) : null}
            {event.myStatus ? (
              <Badge variant={event.myStatus === "accepted" ? "accent" : "outline"}>
                {ATTENDANCE_LABELS[event.myStatus]}
              </Badge>
            ) : null}
          </div>
          <p className="text-sm">{formatEventRange(event)}</p>
          {event.location ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              Lieu : {event.location}
            </p>
          ) : null}
          {event.description ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{event.description}</p>
          ) : null}
          {event.attendees.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Invités
              </h3>
              <ul className="flex flex-col gap-1 text-sm">
                {event.attendees.map((attendee) => (
                  <li key={attendee.id} className="flex items-center gap-2">
                    <span className="flex-1 truncate">{attendee.name ?? attendee.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {ATTENDANCE_LABELS[attendee.status] ?? attendee.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {event.myStatus && event.myStatus !== "accepted" ? (
              <Button size="sm" loading={busy} onClick={() => onRespond("accepted")}>
                Accepter
              </Button>
            ) : null}
            {event.myStatus && event.myStatus !== "declined" ? (
              <Button
                size="sm"
                variant="outline"
                loading={busy}
                onClick={() => onRespond("declined")}
              >
                Refuser
              </Button>
            ) : null}
            {event.canEdit ? (
              <Button size="sm" variant="outline" onClick={() => onEdit(event)}>
                Modifier
              </Button>
            ) : null}
            {event.canEdit ? (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                onClick={() => onDelete(event)}
              >
                Supprimer
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
