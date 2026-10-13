import { Separator } from "@workspace/ui";

/**
 * Séparateur de messages non lus — filet horizontal encadrant le libellé. Le
 * texte porte l'information (les filets seuls seraient invisibles pour les
 * technologies d'assistance) ; la région est annoncée poliment à l'ouverture
 * d'une conversation pour situer la reprise de lecture.
 */
export function UnreadSeparator({ count }: { count: number }) {
  return (
    <div aria-live="polite" className="flex items-center gap-2 py-1" data-testid="unread-separator">
      <Separator className="shrink-0 bg-primary/50" />
      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
        {count > 1 ? `${count} nouveaux messages` : "Nouveau message"}
      </span>
      <Separator className="shrink-0 bg-primary/50" />
    </div>
  );
}
