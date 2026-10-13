import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_LABELS,
  formatAgendaDay,
  formatEventRange,
  formatTime,
  RECURRENCE_LABELS,
  RECURRENCE_OPTIONS,
} from "../src/ui/event-labels.ts";

/** Dates locales : les tests ne dépendent pas du fuseau de la machine. */
function localIso(day: number, hour: number, minute: number): string {
  return new Date(2026, 9, day, hour, minute, 0, 0).toISOString();
}

describe("libellés — heures et plages", () => {
  it("affiche une heure au format français", () => {
    expect(formatTime(localIso(13, 9, 5))).toBe("09:05");
    expect(formatTime(localIso(13, 23, 59))).toBe("23:59");
  });

  it("affiche la plage d'un événement horaire", () => {
    expect(
      formatEventRange({
        startsAt: localIso(13, 9, 0),
        endsAt: localIso(13, 10, 30),
        allDay: false,
      }),
    ).toBe("Mardi 13 octobre 2026 · 09:00 – 10:30");
  });

  it("affiche une journée entière sans heures ni décalage de fuseau", () => {
    // Stockée en minuit UTC : le jour affiché reste celui de la date stockée.
    expect(
      formatEventRange({
        startsAt: "2026-10-13T00:00:00.000Z",
        endsAt: "2026-10-14T00:00:00.000Z",
        allDay: true,
      }),
    ).toBe("Mardi 13 octobre 2026 · journée entière");
  });

  it("annonce une journée entière même avec une heure résiduelle", () => {
    // Le service ramène toujours à minuit UTC ; l'affichage suit la date.
    expect(
      formatEventRange({
        startsAt: "2026-02-28T00:00:00.000Z",
        endsAt: "2026-03-01T00:00:00.000Z",
        allDay: true,
      }),
    ).toBe("Samedi 28 février 2026 · journée entière");
  });
});

describe("libellés — agenda", () => {
  it("nomme aujourd'hui et demain", () => {
    const now = new Date(2026, 9, 13, 12, 0);
    expect(formatAgendaDay(new Date(2026, 9, 13, 23, 59), now)).toBe("Aujourd'hui");
    expect(formatAgendaDay(new Date(2026, 9, 14, 0, 1), now)).toBe("Demain");
  });

  it("affiche le jour et le mois au-delà de demain", () => {
    const now = new Date(2026, 9, 13, 12, 0);
    expect(formatAgendaDay(new Date(2026, 9, 20), now)).toBe("20 octobre");
    expect(formatAgendaDay(new Date(2026, 10, 1), now)).toBe("1 novembre");
  });

  it("ne confond pas le dernier jour du mois avec le premier du suivant", () => {
    const now = new Date(2026, 9, 31, 23, 0);
    expect(formatAgendaDay(new Date(2026, 10, 1, 1, 0), now)).toBe("Demain");
  });
});

describe("libellés — récurrences et invitations", () => {
  it("propose les quatre récurrences, aucune en tête", () => {
    expect(RECURRENCE_OPTIONS).toEqual(["none", "daily", "weekly", "monthly"]);
    expect(RECURRENCE_LABELS.none).toBe("Aucune");
    expect(RECURRENCE_LABELS.daily).toBe("Quotidienne");
    expect(RECURRENCE_LABELS.weekly).toBe("Hebdomadaire");
    expect(RECURRENCE_LABELS.monthly).toBe("Mensuelle");
  });

  it("libelle les statuts d'invitation en français", () => {
    expect(ATTENDANCE_LABELS.invited).toBe("Invité");
    expect(ATTENDANCE_LABELS.accepted).toBe("A accepté");
    expect(ATTENDANCE_LABELS.declined).toBe("A refusé");
  });
});
