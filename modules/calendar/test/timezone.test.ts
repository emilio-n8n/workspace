import { describe, expect, it } from "vitest";
import {
  browserTimeZone,
  DEFAULT_TIME_ZONE,
  formatDayInZone,
  formatTimeInZone,
  formatZoneDelta,
  isValidTimeZone,
  listTimeZoneOptions,
  parseStoredTimeZone,
  supportedTimeZones,
  zonedDate,
  zonedDayKey,
  zonedParts,
  zonedTimeToInstant,
  zoneOffsetDelta,
  zoneOffsetLabel,
  zoneOffsetMinutes,
} from "../src/ui/timezone.ts";

/** Mardi 13 octobre 2026, 23:30 UTC (donc 14 octobre, 01:30 à Paris). */
const LATE_UTC = "2026-10-13T23:30:00.000Z";
/** Mardi 13 octobre 2026, 09:05 UTC (11:05 à Paris en été). */
const MORNING_UTC = "2026-07-13T09:05:00.000Z";

describe("fuseaux — sélection", () => {
  it("propose une liste restreinte, Paris en tête et UTC en queue", () => {
    const options = listTimeZoneOptions(new Date("2026-07-13T00:00:00Z"));
    expect(options.length).toBeGreaterThan(20);
    expect(options[0]?.id).toBe(DEFAULT_TIME_ZONE);
    expect(options.at(-1)?.id).toBe("UTC");
    // Chaque libellé porte son décalage : pas de fuseau sans indication.
    for (const option of options) {
      expect(option.label).toMatch(/\(UTC[+−]?[\d:]*\)$/);
    }
    // La liste est triée alphabétiquement entre les deux extrêmes.
    const middleIds = options.slice(1, -1).map((option) => option.id);
    expect(middleIds).toEqual([...middleIds].sort((a, b) => a.localeCompare(b, "fr")));
  });

  it("contient le fuseau du navigateur même hors de la liste", () => {
    const ids = listTimeZoneOptions().map((option) => option.id);
    expect(ids).toContain(browserTimeZone());
  });

  it("reconnaît les fuseaux valides et refuse les inconnus", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("relit une préférence valide et retombe sur Paris sinon", () => {
    expect(parseStoredTimeZone("America/New_York")).toBe("America/New_York");
    expect(parseStoredTimeZone(" Europe/Paris ")).toBe("Europe/Paris");
    expect(parseStoredTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(parseStoredTimeZone("")).toBe(DEFAULT_TIME_ZONE);
    expect(parseStoredTimeZone("Atlantide")).toBe(DEFAULT_TIME_ZONE);
  });

  it("expose les fuseaux de la plateforme quand elle les fournit", () => {
    const zones = supportedTimeZones();
    expect(zones).toContain("Europe/Paris");
    expect(zones.length).toBeGreaterThan(20);
  });
});

describe("fuseaux — conversion à l'affichage", () => {
  it("lit les parties d'un instant dans le fuseau choisi", () => {
    expect(zonedParts(LATE_UTC, "Europe/Paris")).toEqual({
      year: 2026,
      month: 10,
      day: 14,
      hours: 1,
      minutes: 30,
    });
    expect(zonedParts(LATE_UTC, "UTC")).toEqual({
      year: 2026,
      month: 10,
      day: 13,
      hours: 23,
      minutes: 30,
    });
    // Fuseau très en avance : le jour bascule au lendemain.
    expect(zonedDayKey(LATE_UTC, "Pacific/Auckland")).toBe("2026-10-14");
  });

  it("affiche l'heure du fuseau, pas celle de l'appareil", () => {
    expect(formatTimeInZone(MORNING_UTC, "Europe/Paris")).toBe("11:05");
    expect(formatTimeInZone(MORNING_UTC, "UTC")).toBe("09:05");
    expect(formatTimeInZone(MORNING_UTC, "America/New_York")).toBe("05:05");
    // Décalage d'une demi-heure (Calcutta) : les minutes suivent.
    expect(formatTimeInZone("2026-10-13T09:05:00.000Z", "Asia/Kolkata")).toBe("14:35");
  });

  it("fournit une date locale alignée sur le fuseau (grilles et libellés)", () => {
    const date = zonedDate(LATE_UTC, "Pacific/Auckland");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(9);
    expect(date.getDate()).toBe(14);
  });

  it("formate une date complète en français dans le fuseau", () => {
    expect(formatDayInZone("2026-10-13T23:30:00.000Z", "UTC")).toBe("Mardi 13 octobre 2026");
    expect(formatDayInZone(LATE_UTC, "Europe/Paris")).toBe("Mercredi 14 octobre 2026");
    expect(formatDayInZone(LATE_UTC, "America/New_York")).toBe("Mardi 13 octobre 2026");
  });
});

describe("fuseaux — décalages", () => {
  it("calcule le décalage d'un fuseau, heure d'été comprise", () => {
    expect(zoneOffsetMinutes(MORNING_UTC, "Europe/Paris")).toBe(120); // juillet : +2
    expect(zoneOffsetMinutes("2026-01-13T09:05:00.000Z", "Europe/Paris")).toBe(60); // janvier : +1
    expect(zoneOffsetMinutes(LATE_UTC, "UTC")).toBe(0);
    expect(zoneOffsetMinutes(LATE_UTC, "America/New_York")).toBe(-240);
  });

  it("libelle le décalage en français", () => {
    expect(zoneOffsetLabel("Europe/Paris", new Date("2026-07-13T00:00:00Z"))).toBe("UTC+2");
    expect(zoneOffsetLabel("UTC")).toBe("UTC");
    expect(zoneOffsetLabel("America/New_York", new Date("2026-07-13T00:00:00Z"))).toBe("UTC−4");
    expect(zoneOffsetLabel("Asia/Kolkata", new Date("2026-07-13T00:00:00Z"))).toBe("UTC+5:30");
  });

  it("compare un fuseau à celui de l'appareil", () => {
    const browser = browserTimeZone();
    expect(zoneOffsetDelta("UTC", browser)).toBe(0);
    expect(formatZoneDelta(browser)).toBe("Même heure que votre appareil");

    const delta = formatZoneDelta("UTC", new Date("2026-07-13T00:00:00Z"));
    // Le message dépend du fuseau de la machine, mais reste informatif.
    expect(delta).toMatch(/(Même heure|d'avance|de retard)/);
  });
});

describe("fuseaux — conversion inverse", () => {
  it("convertit une heure locale d'un fuseau en instant UTC", () => {
    expect(zonedTimeToInstant("2026-07-13", "09:05", "Europe/Paris").toISOString()).toBe(
      "2026-07-13T07:05:00.000Z",
    );
    expect(zonedTimeToInstant("2026-07-13", "09:05", "UTC").toISOString()).toBe(
      "2026-07-13T09:05:00.000Z",
    );
    expect(zonedTimeToInstant("2026-07-13", "09:05", "America/New_York").toISOString()).toBe(
      "2026-07-13T13:05:00.000Z",
    );
  });

  it("suit le changement d'heure d'automne", () => {
    // Le 25 octobre 2026, l'Europe passe de UTC+2 à UTC+1.
    expect(zonedTimeToInstant("2026-10-24", "09:05", "Europe/Paris").toISOString()).toBe(
      "2026-10-24T07:05:00.000Z",
    );
    expect(zonedTimeToInstant("2026-10-25", "09:05", "Europe/Paris").toISOString()).toBe(
      "2026-10-25T08:05:00.000Z",
    );
  });

  it("fait l'aller-retour avec la lecture d'affichage", () => {
    const instant = zonedTimeToInstant("2026-07-13", "09:05", "Europe/Paris");
    expect(formatTimeInZone(instant, "Europe/Paris")).toBe("09:05");
    expect(zonedDayKey(instant, "Europe/Paris")).toBe("2026-07-13");
  });

  it("ramène une heure inexistante à la fin du saut d'heure", () => {
    // 02:30 le 29 mars 2026 n'existe pas à Paris (02:00 → 03:00) : l'instant
    // retenu correspond à 03:30, la fin du saut.
    const instant = zonedTimeToInstant("2026-03-29", "02:30", "Europe/Paris");
    expect(formatTimeInZone(instant, "Europe/Paris")).toBe("03:30");
  });
});
