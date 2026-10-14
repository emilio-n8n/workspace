/**
 * Fuseaux horaires d'affichage : sélection, conversion à l'affichage et
 * indicateur de décalage.
 *
 * Le stockage reste en UTC (ISO) : le fuseau ne sert qu'à présenter les
 * instants. Toutes les fonctions sont pures (test/timezone.test.ts) et
 * n'utilisent que `Intl`.
 */

/** Fuseau de repli si le navigateur n'en expose aucun. */
export const FALLBACK_TIME_ZONE = "UTC";

/** Fuseau proposé en tête de liste. */
export const DEFAULT_TIME_ZONE = "Europe/Paris";

/** Fuseaux proposés : France d'abord, puis les zones les plus courantes. */
const CURATED_TIME_ZONES = [
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Luxembourg",
  "Europe/Zurich",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Rome",
  "Europe/Vienna",
  "Europe/Warsaw",
  "Europe/Prague",
  "Europe/Athens",
  "Europe/Bucharest",
  "Europe/Helsinki",
  "Europe/Kyiv",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Africa/Casablanca",
  "Africa/Algiers",
  "Africa/Tunis",
  "Africa/Abidjan",
  "Africa/Dakar",
  "Africa/Lagos",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "America/Montreal",
  "America/Toronto",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  "America/Guadeloupe",
  "America/Cayenne",
  "Asia/Jerusalem",
  "Asia/Beirut",
  "Asia/Dubai",
  "Asia/Tehran",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Taipei",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Pacific/Honolulu",
  "UTC",
];

/** Option de la liste déroulante des fuseaux. */
export type TimeZoneOption = {
  id: string;
  /** Libellé lisible : « Europe/Paris (UTC+2) ». */
  label: string;
};

/** Parties d'une date lues dans un fuseau donné. */
export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
};

/** Formateurs réutilisés : en créer un par appel coûterait cher en boucle. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** Formateur des parties numériques d'une date dans un fuseau. */
function partsFormatter(zone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(zone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hourCycle: "h23", // évite le « 24:00 » de certaines versions d'ICU
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  formatterCache.set(zone, formatter);
  return formatter;
}

/** Formateur d'une date complète en français dans un fuseau. */
function longDayFormatter(zone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(`fr:${zone}`);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("fr-FR", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  formatterCache.set(`fr:${zone}`, formatter);
  return formatter;
}

/** Fuseau du navigateur, avec repli si l'API n'en fournit pas. */
export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/** Tous les fuseaux connus de la plateforme (listes ICU complètes). */
export function supportedTimeZones(): string[] {
  const api = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  if (typeof api.supportedValuesOf === "function") {
    try {
      const zones = api.supportedValuesOf("timeZone");
      if (Array.isArray(zones) && zones.length > 0) return zones;
    } catch {
      // Repli sur la liste interne.
    }
  }
  return CURATED_TIME_ZONES;
}

/** `true` si le fuseau est reconnu par `Intl`. */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: zone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lit une préférence de fuseau. Une valeur absente, inconnue de la plateforme
 * ou corrompue retombe sur le fuseau de repli : jamais d'affichage cassé.
 */
export function parseStoredTimeZone(raw: string | null | undefined): string {
  if (typeof raw !== "string") return DEFAULT_TIME_ZONE;
  const zone = raw.trim();
  if (zone.length === 0) return DEFAULT_TIME_ZONE;
  return isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
}

/** Liste restreinte de fuseaux, complétée du fuseau du navigateur. */
export function listTimeZoneOptions(now: Date = new Date()): TimeZoneOption[] {
  const zones = [...CURATED_TIME_ZONES];
  const browser = browserTimeZone();
  if (!zones.includes(browser)) zones.push(browser);
  // Paris en tête (application francophone), UTC en queue, le reste alphabétique.
  const options = zones.map((zone) => ({
    id: zone,
    label: `${zone.replace(/_/g, " ")} (${zoneOffsetLabel(zone, now)})`,
    rank: zone === DEFAULT_TIME_ZONE ? 0 : zone === "UTC" ? 2 : 1,
  }));
  options.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.id.localeCompare(b.id, "fr")));
  return options.map(({ id, label }) => ({ id, label }));
}

/** Parties de la date d'un instant, lues dans `zone`. */
export function zonedParts(instant: Date | string | number, zone: string): ZonedParts {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = partsFormatter(zone).formatToParts(date);
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    // `hourCycle: "h23"` évite le « 24:00 » de certaines versions d'ICU.
    day: value("day"),
    hours: value("hour"),
    minutes: value("minute"),
  };
}

/**
 * Date locale dont l'année, le mois et le jour sont ceux du fuseau pour cet
 * instant : les grilles et les libellés travaillent ensuite comme si
 * l'utilisateur était dans ce fuseau.
 */
export function zonedDate(instant: Date | string | number, zone: string): Date {
  const parts = zonedParts(instant, zone);
  return new Date(parts.year, parts.month - 1, parts.day);
}

/** Clé de jour `aaaa-mm-jj` d'un instant dans `zone`. */
export function zonedDayKey(instant: Date | string | number, zone: string): string {
  const parts = zonedParts(instant, zone);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

/** Heure d'un instant dans `zone`, au format français « 09:05 ». */
export function formatTimeInZone(instant: Date | string | number, zone: string): string {
  const parts = zonedParts(instant, zone);
  return `${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}`;
}

/** Date complète d'un instant dans `zone` : « mardi 13 octobre 2026 ». */
export function formatDayInZone(instant: Date | string | number, zone: string): string {
  const label = longDayFormatter(zone).format(
    instant instanceof Date ? instant : new Date(instant),
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Décalage d'un fuseau à un instant donné, en minutes (« +120 » pour UTC+2). */
export function zoneOffsetMinutes(instant: Date | string | number, zone: string): number {
  const date = instant instanceof Date ? instant : new Date(instant);
  // Les offsets sont des nombres entiers de minutes : tronquer l'instant à la
  // minute évite qu'une seconde résiduelle fausse l'arrondi.
  const truncated = Math.floor(date.getTime() / 60_000) * 60_000;
  const zoned = zonedParts(new Date(truncated), zone);
  const asUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hours, zoned.minutes);
  return Math.round((asUtc - truncated) / 60_000);
}

/** Libellé du décalage d'un fuseau : « UTC+2 », « UTC-5 », « UTC ». */
export function zoneOffsetLabel(zone: string, now: Date = new Date()): string {
  const minutes = zoneOffsetMinutes(now, zone);
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "−";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return `UTC${sign}${hours}${rest > 0 ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/**
 * Instant correspondant à une heure locale *dans un fuseau* (`2026-10-13`,
 * `09:05`). Le décalage est résolu en deux passes pour couvrir les passages à
 * l'heure d'été ; une heure inexistante (2h30 le jour du changement) est
 * ramenée à la fin du saut.
 */
export function zonedTimeToInstant(dateInput: string, timeInput: string, zone: string): Date {
  const date = parseLocalDate(dateInput);
  const [hours, minutes] = timeInput.split(":").map(Number);
  const wallClock = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hours ?? 0,
    minutes ?? 0,
  );
  const first = wallClock - zoneOffsetMinutes(new Date(wallClock), zone) * 60_000;
  const instant = wallClock - zoneOffsetMinutes(new Date(first), zone) * 60_000;
  return new Date(instant);
}

/** Lit une date `aaaa-mm-jj` en jour UTC (sans interprétation locale). */
function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return new Date(NaN);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/** Écart en heures entre deux fuseaux à un instant donné (> 0 : en avance). */
export function zoneOffsetDelta(zone: string, otherZone: string, now: Date = new Date()): number {
  const minutes = zoneOffsetMinutes(now, zone) - zoneOffsetMinutes(now, otherZone);
  return minutes / 60;
}

/**
 * Indicateur de décalage affiché sous le sélecteur de fuseau : comparaison
 * avec le fuseau de l'appareil, en français.
 */
export function formatZoneDelta(zone: string, now: Date = new Date()): string {
  const browser = browserTimeZone();
  if (zone === browser) return "Même heure que votre appareil";
  const delta = zoneOffsetDelta(zone, browser, now);
  if (delta === 0) return "Même heure que votre appareil";
  const hours = Math.abs(delta);
  const value = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(".", ",");
  return delta > 0
    ? `${value} h d'avance sur votre appareil`
    : `${value} h de retard sur votre appareil`;
}
