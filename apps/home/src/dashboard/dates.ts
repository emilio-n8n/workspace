/**
 * Dates en français du tableau de bord.
 *
 * Tout est relatif tant que c'est lisible (« il y a 3 h », « hier »), puis
 * absolu au-delà (« il y a 2 mois »). Aucune dépendance externe : `Date` et
 * `Intl` suffisent, et le calcul reste identique à chaque rendu.
 */

/** Regroupements des fichiers récents, dans l'ordre d'affichage. */
export const RECENT_GROUPS = [
  { id: "today", label: "Aujourd'hui" },
  { id: "week", label: "Cette semaine" },
  { id: "earlier", label: "Plus tôt" },
] as const;

export type RecentGroupId = (typeof RECENT_GROUPS)[number]["id"];

/** Forme minimale attendue : un identifiant et un horodatage ISO. */
export type RecentEntry = { id: string; updatedAt: string };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Minuit local d'un instant — le regroupement se fait par jour calendaire. */
function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Jours calendaires entre deux instants (0 = même jour). */
export function daysApart(from: number, to: number): number {
  return Math.round((startOfDay(from) - startOfDay(to)) / DAY);
}

/** Date relative courte, lisible sans réfléchir. */
export function formatRelativeDate(iso: string, now: number = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "date inconnue";

  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE) return "à l'instant";
  if (elapsed < HOUR) return `il y a ${Math.floor(elapsed / MINUTE)} min`;
  if (elapsed < DAY) return `il y a ${Math.floor(elapsed / HOUR)} h`;

  const days = Math.max(1, daysApart(now, timestamp));
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} jours`;
  if (days < 14) return "la semaine dernière";
  if (days < 31) return `il y a ${Math.floor(days / 7)} semaines`;
  if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;

  const years = Math.floor(days / 365);
  return years === 1 ? "il y a un an" : `il y a ${years} ans`;
}

/** Regroupe des entrées par fraîcheur ; les groupes vides sont omis. */
export function groupRecent<T extends RecentEntry>(
  entries: T[],
  now: number = Date.now(),
): { id: RecentGroupId; label: string; entries: T[] }[] {
  const buckets: Record<RecentGroupId, T[]> = { today: [], week: [], earlier: [] };

  for (const entry of entries) {
    const timestamp = Date.parse(entry.updatedAt);
    // Une date illisible part dans « Plus tôt » plutôt que de disparaître.
    const days = Number.isNaN(timestamp)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, daysApart(now, timestamp));
    if (days === 0) buckets.today.push(entry);
    else if (days < 7) buckets.week.push(entry);
    else buckets.earlier.push(entry);
  }

  return RECENT_GROUPS.map(({ id, label }) => ({ id, label, entries: buckets[id] })).filter(
    (group) => group.entries.length > 0,
  );
}
