import { describe, expect, it } from "vitest";
import {
  isInsideModal,
  isTypingTarget,
  slideNavigationAnnouncement,
  slideNavigationTarget,
} from "../src/slide-navigation.ts";

describe("slides — navigation clavier entre diapositives", () => {
  it("avance et recule avec les flèches et Page préc./suiv.", () => {
    for (const key of ["ArrowRight", "ArrowDown", "PageDown"]) {
      expect(slideNavigationTarget({ key, count: 5, current: 1 })).toBe(2);
    }
    for (const key of ["ArrowLeft", "ArrowUp", "PageUp"]) {
      expect(slideNavigationTarget({ key, count: 5, current: 3 })).toBe(2);
    }
  });

  it("va à la première et à la dernière diapositive", () => {
    expect(slideNavigationTarget({ key: "Home", count: 5, current: 3 })).toBe(0);
    expect(slideNavigationTarget({ key: "End", count: 5, current: 3 })).toBe(4);
  });

  it("ne dépasse jamais les bornes et n'annonce rien alors", () => {
    expect(slideNavigationTarget({ key: "ArrowRight", count: 3, current: 2 })).toBeNull();
    expect(slideNavigationTarget({ key: "End", count: 3, current: 2 })).toBeNull();
    expect(slideNavigationTarget({ key: "ArrowLeft", count: 3, current: 0 })).toBeNull();
    expect(slideNavigationTarget({ key: "Home", count: 3, current: 0 })).toBeNull();
  });

  it("laisse le clavier aux raccourcis et aux autres touches", () => {
    // Alt + flèche réordonne dans la bande : pas de navigation concurrente.
    expect(
      slideNavigationTarget({ key: "ArrowRight", altKey: true, count: 3, current: 0 }),
    ).toBeNull();
    expect(
      slideNavigationTarget({ key: "ArrowDown", ctrlKey: true, count: 3, current: 0 }),
    ).toBeNull();
    expect(
      slideNavigationTarget({ key: "PageDown", metaKey: true, count: 3, current: 0 }),
    ).toBeNull();
    expect(slideNavigationTarget({ key: "a", count: 3, current: 0 })).toBeNull();
    expect(slideNavigationTarget({ key: "Enter", count: 3, current: 0 })).toBeNull();
  });

  it("ne navigue pas sans diapositive", () => {
    expect(slideNavigationTarget({ key: "ArrowRight", count: 0, current: 0 })).toBeNull();
  });

  it("annonce la position atteinte", () => {
    expect(slideNavigationAnnouncement(0, 1)).toBe("Diapositive 1 sur 1.");
    expect(slideNavigationAnnouncement(11, 12)).toBe("Diapositive 12 sur 12.");
  });
});

describe("slides — suspension de la navigation", () => {
  it("ignore les champs de saisie", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });

  it("laisse les fenêtres modales garder le clavier", () => {
    // Doublures minimales d'Element : seul `closest` est interrogé.
    const inDialog = { closest: (selector: string) => (selector.includes("dialog") ? {} : null) };
    const inPanel = { closest: () => null };
    expect(isInsideModal(inDialog as unknown as Element)).toBe(true);
    expect(isInsideModal(inPanel as unknown as Element)).toBe(false);
    expect(isInsideModal(null)).toBe(false);
    expect(isInsideModal({} as unknown as Element)).toBe(false);
  });
});
