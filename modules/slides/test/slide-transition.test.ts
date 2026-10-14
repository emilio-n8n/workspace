import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIDE_TRANSITION,
  normalizeTransition,
  normalizeTransitionMs,
  SLIDE_TRANSITION_IDS,
  transitionDuration,
  transitionFrames,
  transitionHint,
  transitionLabel,
  transitionSummary,
} from "../src/slide-transition.ts";

describe("slides — transitions", () => {
  it("propose cinq transitions, dont « Aucune »", () => {
    expect(SLIDE_TRANSITION_IDS).toEqual(["none", "fade", "slide", "push", "wipe"]);
    for (const id of SLIDE_TRANSITION_IDS) {
      expect(transitionLabel(id).length).toBeGreaterThan(0);
      expect(transitionHint(id).length).toBeGreaterThan(0);
    }
  });

  it("relit une transition inconnue vers « Aucune »", () => {
    expect(normalizeTransition("fade")).toBe("fade");
    expect(normalizeTransition("vortex")).toBe(DEFAULT_SLIDE_TRANSITION);
    expect(normalizeTransition(42)).toBe(DEFAULT_SLIDE_TRANSITION);
  });

  it("borne la durée entre 200 et 2 000 ms, avec 400 ms par défaut", () => {
    expect(normalizeTransitionMs(700)).toBe(700);
    expect(normalizeTransitionMs(100)).toBe(200);
    expect(normalizeTransitionMs(99_999)).toBe(2000);
    expect(normalizeTransitionMs(Number.NaN)).toBe(400);
    expect(normalizeTransitionMs(733.6)).toBe(734);
  });

  it("ne fournit aucune image-clé pour « Aucune » ou animations réduites", () => {
    expect(transitionFrames("none")).toBeNull();
    expect(transitionFrames("fade", { reduceMotion: true })).toBeNull();
  });

  it("décrit chaque transition par ses images-clés", () => {
    expect(transitionFrames("fade")?.from).toMatchObject({ opacity: 0 });
    expect(transitionFrames("slide")?.from).toMatchObject({ transform: "translateX(18%)" });
    expect(transitionFrames("push")?.from).toMatchObject({ transform: "translateX(100%)" });
    expect(transitionFrames("wipe")?.from).toMatchObject({ clipPath: "inset(0 100% 0 0)" });
  });

  it("annule la durée pour « Aucune » ou animations réduites", () => {
    expect(transitionDuration("none", 400)).toBe(0);
    expect(transitionDuration("fade", 400, { reduceMotion: true })).toBe(0);
    expect(transitionDuration("fade", 700)).toBe(700);
  });

  it("résume une transition pour les annonces", () => {
    expect(transitionSummary("none", 400)).toBe("Aucune transition.");
    expect(transitionSummary("fade", 700)).toBe("Fondu, 700 ms.");
  });
});
