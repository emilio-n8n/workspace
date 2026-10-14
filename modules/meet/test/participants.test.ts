import { describe, expect, it } from "vitest";
import {
  canModerate,
  handAnnouncement,
  moderateMicrophoneLabel,
  muteAnnouncement,
  mutedByHostLabel,
  orderParticipants,
  type ParticipantStateView,
  participantsCountLabel,
  raisedHandLabel,
  raisedHandQueue,
  raisedHandsCountLabel,
  raiseHandLabel,
  removalAnnouncement,
  roleActionLabel,
  roleAnnouncement,
  roleLabel,
} from "../src/participants.ts";

const state = (overrides: Partial<ParticipantStateView> = {}): ParticipantStateView => ({
  userId: "usr_1",
  name: "Alice",
  role: "participant",
  self: false,
  mutedByHost: false,
  removed: false,
  handRaised: false,
  handRaisedAt: null,
  ...overrides,
});

describe("meet — rôles et modération", () => {
  it("nomme chaque rôle en français", () => {
    expect(roleLabel(state({ role: "host" }))).toBe("Créateur");
    expect(roleLabel(state({ role: "moderator" }))).toBe("Animateur");
    expect(roleLabel(state({ role: "participant" }))).toBe("Participant");
    expect(roleLabel(state({ self: true, role: "host" }))).toBe("Vous");
  });

  it("donne le droit de modération au créateur et aux animateurs présents", () => {
    expect(canModerate({ isCreator: true, role: "host", removed: false, left: false })).toBe(true);
    expect(canModerate({ isCreator: false, role: "moderator", removed: false, left: false })).toBe(
      true,
    );
    expect(
      canModerate({ isCreator: false, role: "participant", removed: false, left: false }),
    ).toBe(false);
  });

  it("retire le droit de modération à une personne retirée ou raccrochée", () => {
    expect(canModerate({ isCreator: false, role: "moderator", removed: true, left: false })).toBe(
      false,
    );
    expect(canModerate({ isCreator: false, role: "moderator", removed: false, left: true })).toBe(
      false,
    );
  });

  it("ordonne l'effectif : créateur, animateurs, puis participants par nom", () => {
    const ordered = orderParticipants([
      state({ userId: "c", name: "Chloé" }),
      state({ userId: "a", name: "Alice" }),
      state({ userId: "m", name: "Marc", role: "moderator" }),
      state({ userId: "h", name: "Hôte", role: "host" }),
    ]);
    expect(ordered.map((p) => p.userId)).toEqual(["h", "m", "a", "c"]);
  });

  it("compte l'effectif avec un français correct", () => {
    expect(participantsCountLabel(0)).toBe("Aucun participant");
    expect(participantsCountLabel(1)).toBe("1 participant");
    expect(participantsCountLabel(3)).toBe("3 participants");
  });

  it("ordonne la file des mains levées par moment de levée", () => {
    const queue = raisedHandQueue([
      state({ userId: "b", name: "Bruno", handRaised: true, handRaisedAt: "2026-01-01T10:00:02Z" }),
      state({ userId: "a", name: "Alice", handRaised: true, handRaisedAt: "2026-01-01T10:00:01Z" }),
      state({ userId: "c", name: "Chloé", handRaised: false, handRaisedAt: null }),
    ]);
    expect(queue.map((p) => p.userId)).toEqual(["a", "b"]);
  });

  it("annonce chaque action de modération en français", () => {
    expect(handAnnouncement("Alice", true)).toBe("Alice a levé la main.");
    expect(handAnnouncement("Alice", false)).toBe("Alice a baissé la main.");
    expect(muteAnnouncement("Alice", true)).toBe("Micro de Alice coupé par l'organisateur.");
    expect(muteAnnouncement("Alice", false)).toBe("Micro de Alice rétabli par l'organisateur.");
    expect(removalAnnouncement("Alice")).toBe(
      "Alice a été retiré de la réunion par l'organisateur.",
    );
  });

  it("libelle le bouton de modération du micro d'autrui", () => {
    expect(moderateMicrophoneLabel(state({ mutedByHost: true }))).toBe("Rétablir le micro");
    expect(moderateMicrophoneLabel(state({ mutedByHost: false }))).toBe("Couper le micro");
  });

  it("annonce et libelle la nomination des animateurs", () => {
    expect(roleAnnouncement("Alice", "moderator")).toBe("Alice est désormais animateur.");
    expect(roleAnnouncement("Alice", "participant")).toBe("Alice n'est plus animateur.");
    expect(roleActionLabel("moderator")).toBe("Retirer le rôle d'animateur");
    expect(roleActionLabel("participant")).toBe("Nommer animateur");
    // Le rôle du créateur n'est jamais rétrogradable : le libellé reste celui d'une promotion.
    expect(roleActionLabel("host")).toBe("Nommer animateur");
  });

  it("libelle la main levée et son décompte", () => {
    expect(raiseHandLabel(true)).toBe("Baisser la main");
    expect(raiseHandLabel(false)).toBe("Lever la main");
    expect(raisedHandLabel()).toBe("Main levée");
    expect(mutedByHostLabel()).toBe("Micro coupé par l'organisateur");
    expect(raisedHandsCountLabel(0)).toBe("Aucune main levée");
    expect(raisedHandsCountLabel(1)).toBe("1 main levée");
    expect(raisedHandsCountLabel(3)).toBe("3 mains levées");
  });
});
