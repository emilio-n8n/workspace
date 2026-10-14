import { cn } from "@workspace/ui";
import { splitMentionSegments } from "./mentions.ts";
import type { MatchRange } from "./search.ts";
import { highlightSegments, type SearchSegment } from "./search.ts";

export type MessageBodyProps = {
  body: string;
  /** Bornes des correspondances de la recherche (absolues, sur tout le message). */
  ranges?: readonly MatchRange[];
  /** Index global de la correspondance active (celle que pointe la navigation). */
  activeMatchIndex?: number | null;
  /** Index global de la première correspondance de CE message. */
  firstMatchIndex?: number;
};

/** Identifiant DOM de la correspondance active (pour le défilement et le focus). */
export const ACTIVE_MATCH_ID = "chat-match-active";

/**
 * Corps d'un message : mentions en puces et, si une recherche est active,
 * correspondances surlignées. Les deux décorations se superposent sans se
 * marcher dessus — une mention n'est jamais découpée par un surlignage.
 */
export function MessageBody({
  body,
  ranges,
  activeMatchIndex = null,
  firstMatchIndex = 0,
}: MessageBodyProps) {
  const segments = splitMentionSegments(body);
  let cursor = 0;

  return (
    <>
      {segments.map((segment) => {
        const start = cursor;
        cursor += segment.text.length;
        // Les clés viennent de la position dans le message : stables d'un rendu
        // à l'autre, contraires à un simple index de tableau.
        const key = `${start}-${segment.mention ? "m" : "t"}`;
        if (segment.mention) {
          return (
            <span key={key} className="rounded bg-primary/10 px-1 font-medium text-primary">
              {segment.text}
            </span>
          );
        }
        // Le segment est du texte brut : on ne garde que les correspondances qui
        // le concernent, ramenées en coordonnées locales.
        const local: MatchRange[] = (ranges ?? [])
          .filter((range) => range[0] < start + segment.text.length && range[1] > start)
          .map((range) => [
            Math.max(0, range[0] - start),
            Math.min(segment.text.length, range[1] - start),
          ]);
        const pieces: SearchSegment[] = highlightSegments(segment.text, local);
        let index =
          local.length > 0
            ? firstMatchIndex + (ranges ?? []).filter((r) => r[1] <= start).length
            : 0;
        return (
          <span key={key}>
            {pieces.map((piece) => {
              if (!piece.match) {
                return (
                  <span key={`${start}-${piece.text}`} className="whitespace-pre-wrap break-words">
                    {piece.text}
                  </span>
                );
              }
              const globalIndex = index;
              index += 1;
              const active = globalIndex === activeMatchIndex;
              return (
                <mark
                  key={`${start}-${globalIndex}`}
                  id={active ? ACTIVE_MATCH_ID : undefined}
                  // Focusable à la demande : la navigation dans les résultats
                  // amène le focus sur l'occurrence, sans jamais le voler avant.
                  tabIndex={active ? -1 : undefined}
                  className={cn(
                    "rounded bg-primary/20 px-0.5 text-foreground",
                    active && "ring-2 ring-ring",
                  )}
                >
                  {piece.text}
                </mark>
              );
            })}
          </span>
        );
      })}
    </>
  );
}
