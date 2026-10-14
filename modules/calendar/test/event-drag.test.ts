import { describe, expect, it } from "vitest";
import {
  canMove,
  dragHint,
  dropBlockedReason,
  dropTarget,
  ghostLabel,
  invertStep,
  MOVE_STEPS,
  moveConfirmation,
  moveErrorMessage,
  moveStepLabel,
  shiftEvent,
  stepForShortcut,
  targetKey,
} from "../src/ui/event-drag.ts";

/** Mardi 13 octobre 2026, 09:00 → 10:00 UTC. */
const TIMED = {
  startsAt: "2026-10-13T09:00:00.000Z",
  endsAt: "2026-10-13T10:00:00.000Z",
  allDay: false,
  canEdit: true,
  recurring: false,
};

/** Événement « journée entière » stocké en minuit UTC. */
const ALL_DAY = {
  startsAt: "2026-10-13T00:00:00.000Z",
  endsAt: "2026-10-14T00:00:00.000Z",
  allDay: true,
  canEdit: true,
  recurring: false,
};

const DAY_14 = new Date(2026, 9, 14); // mercredi 14 octobre (date locale)

describe("déplacement — pas", () => {
  it("décale d'un nombre de jours en conservant la durée", () => {
    const target = shiftEvent(TIMED, MOVE_STEPS.day);
    expect(target.startsAt).toBe("2026-10-14T09:00:00.000Z");
    expect(target.endsAt).toBe("2026-10-14T10:00:00.000Z");
  });

  it("décale d'une semaine", () => {
    expect(shiftEvent(TIMED, MOVE_STEPS.week).startsAt).toBe("2026-10-20T09:00:00.000Z");
  });

  it("décale d'une demi-heure pour un événement horaire", () => {
    const target = shiftEvent(TIMED, MOVE_STEPS.halfHour);
    expect(target.startsAt).toBe("2026-10-13T09:30:00.000Z");
    expect(target.endsAt).toBe("2026-10-13T10:30:00.000Z");
  });

  it("inverse un pas dans les deux sens", () => {
    expect(invertStep(MOVE_STEPS.day)).toEqual({ days: -1 });
    expect(invertStep(MOVE_STEPS.week)).toEqual({ weeks: -1 });
    expect(invertStep({ minutes: 30 })).toEqual({ minutes: -30 });
    expect(shiftEvent(TIMED, invertStep(MOVE_STEPS.day)).startsAt).toBe("2026-10-12T09:00:00.000Z");
  });

  it("libelle un pas en français", () => {
    expect(moveStepLabel(MOVE_STEPS.day)).toBe("1 jour");
    expect(moveStepLabel({ days: 2 })).toBe("2 jours");
    expect(moveStepLabel(MOVE_STEPS.week)).toBe("1 semaine");
    expect(moveStepLabel({ minutes: 30 })).toBe("30 minutes");
  });

  it("associe un raccourci clavier à chaque pas", () => {
    expect(stepForShortcut("ArrowLeft")).toEqual({ days: -1 });
    expect(stepForShortcut("ArrowRight")).toEqual({ days: 1 });
    expect(stepForShortcut("ArrowUp")).toEqual({ weeks: -1 });
    expect(stepForShortcut("ArrowDown")).toEqual({ weeks: 1 });
    expect(stepForShortcut("PageUp")).toEqual({ minutes: -30 });
    expect(stepForShortcut("PageDown")).toEqual({ minutes: 30 });
    expect(stepForShortcut("Enter")).toBeNull();
  });
});

describe("déplacement — destination du dépôt", () => {
  it("garde l'heure de début et la durée sur un nouveau jour", () => {
    const target = dropTarget(TIMED, DAY_14);
    expect(target.startsAt).toBe(new Date(2026, 9, 14, 9, 0).toISOString());
    expect(target.endsAt).toBe(new Date(2026, 9, 14, 10, 0).toISOString());
  });

  it("conserve l'heure apparente quand un fuseau est donné", () => {
    // 09:00 UTC affiché à Paris (UTC+2) vaut 11:00 ; déplacé au 14, l'heure
    // apparente doit rester 11:00, donc 09:00 UTC (même décalage en octobre).
    const target = dropTarget(TIMED, DAY_14, "Europe/Paris");
    expect(target.startsAt).toBe("2026-10-14T09:00:00.000Z");
    expect(target.endsAt).toBe("2026-10-14T10:00:00.000Z");
  });

  it("suit le changement d'heure lors d'un déplacement dans un fuseau", () => {
    // Passage à l'heure d'hiver le 25 octobre : l'heure apparente est conservée
    // (11:05 à Paris), donc l'instant UTC bouge d'une heure.
    const beforeWinter = {
      startsAt: "2026-10-24T09:05:00.000Z", // 11:05 à Paris (UTC+2)
      endsAt: "2026-10-24T10:05:00.000Z",
      allDay: false,
      canEdit: true,
      recurring: false,
    };
    const target = dropTarget(beforeWinter, new Date(2026, 9, 25), "Europe/Paris");
    expect(target.startsAt).toBe("2026-10-25T10:05:00.000Z"); // 11:05 à Paris (UTC+1)
  });

  it("ramène une journée entière aux minuits UTC du jour déposé", () => {
    const target = dropTarget(ALL_DAY, DAY_14);
    expect(target.startsAt).toBe("2026-10-14T00:00:00.000Z");
    expect(target.endsAt).toBe("2026-10-15T00:00:00.000Z");
  });

  it("accepte un déplacement sur une série récurrente (toute la série bouge)", () => {
    const series = { ...TIMED, recurring: true };
    const target = dropTarget(series, DAY_14);
    expect(target.startsAt).toBe(new Date(2026, 9, 14, 9, 0).toISOString());
    expect(moveConfirmation(series, target)).toContain("toute la série est déplacée");
  });
});

describe("déplacement — conditions et messages", () => {
  it("refuse de déplacer un événement non modifiable", () => {
    const readOnly = { ...TIMED, canEdit: false };
    expect(canMove(readOnly)).toBe(false);
    expect(dropBlockedReason(readOnly, DAY_14, "2026-10-13")).toBe(
      "Vous n'êtes pas autorisé à déplacer cet événement.",
    );
  });

  it("signale une case de départ sans aucun changement", () => {
    expect(dropBlockedReason(TIMED, new Date(2026, 9, 13), targetKey(new Date(2026, 9, 13)))).toBe(
      "L'événement est déjà sur cette journée.",
    );
  });

  it("laisse passer un dépôt vers un autre jour", () => {
    expect(dropBlockedReason(TIMED, DAY_14, "2026-10-13")).toBeNull();
  });

  it("résume le geste pendant le glissement", () => {
    expect(dragHint({ ...TIMED, title: "Point d'équipe" }, DAY_14)).toBe(
      "Déposer « Point d'équipe » sur le mercredi 14 octobre 2026 ? Lâchez pour confirmer.",
    );
    // Sans titre connu, le message reste compréhensible.
    expect(dragHint(TIMED, DAY_14)).toContain(
      "Déposer « l'événement » sur le mercredi 14 octobre 2026",
    );
  });

  it("affiche un créneau fantôme lisible", () => {
    const target = dropTarget(TIMED, DAY_14, "Europe/Paris");
    expect(ghostLabel(TIMED, target, "Europe/Paris")).toBe("11:00");
    expect(ghostLabel(ALL_DAY, dropTarget(ALL_DAY, DAY_14), "Europe/Paris")).toBe(
      "Journée entière",
    );
  });

  it("confirme un déplacement en français", () => {
    const target = dropTarget(TIMED, DAY_14);
    expect(moveConfirmation(TIMED, target)).toBe("Déplacé au mercredi 14 octobre 2026 à 09:00.");
    expect(moveConfirmation(ALL_DAY, dropTarget(ALL_DAY, DAY_14))).toBe(
      "Déplacé au mercredi 14 octobre 2026.",
    );
  });

  it("traduit une erreur serveur en message français", () => {
    expect(moveErrorMessage(new Error("La fin doit être après le début."))).toBe(
      "La fin doit être après le début.",
    );
    expect(moveErrorMessage(new Error("   "))).toBe("Déplacement impossible.");
    expect(moveErrorMessage(undefined)).toBe("Déplacement impossible.");
  });

  it("expose une clé de jour stable", () => {
    expect(targetKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
