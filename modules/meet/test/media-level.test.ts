import { describe, expect, it } from "vitest";
import {
  activeLevelBars,
  clampLevel,
  LEVEL_GAIN,
  MIC_LEVEL_STEPS,
  micLevelLabel,
  normalizeRms,
  SPEAKING_ENTER_LEVEL,
  SPEAKING_EXIT_LEVEL,
  speakingState,
} from "../src/media-level.ts";

describe("meet — niveau du micro", () => {
  it("ramène n'importe quelle mesure dans [0, 1]", () => {
    expect(clampLevel(0.4)).toBe(0.4);
    expect(clampLevel(-3)).toBe(0);
    expect(clampLevel(9)).toBe(1);
    expect(clampLevel(Number.NaN)).toBe(0);
    expect(clampLevel(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampLevel(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("applique le gain pour remplir le vu-mètre", () => {
    expect(normalizeRms(0)).toBe(0);
    expect(normalizeRms(1 / LEVEL_GAIN)).toBeCloseTo(1, 10);
    expect(normalizeRms(0.02)).toBeCloseTo(0.07, 10);
    expect(normalizeRms(0.5)).toBe(1);
    expect(normalizeRms(Number.NaN)).toBe(0);
  });

  it("allume le bon nombre de barres", () => {
    expect(activeLevelBars(0)).toBe(0);
    expect(activeLevelBars(1)).toBe(MIC_LEVEL_STEPS);
    expect(activeLevelBars(0.5)).toBe(4);
    expect(activeLevelBars(0.5, 5)).toBe(3);
    // Bornes dures : jamais plus de barres que prévu, jamais moins que zéro.
    expect(activeLevelBars(12)).toBe(MIC_LEVEL_STEPS);
    expect(activeLevelBars(-1)).toBe(0);
    // Un nombre de barres invalide retombe sur les 7 barres par défaut.
    expect(activeLevelBars(0.5, 0)).toBe(4);
  });

  it("nomme le niveau pour les lecteurs d'écran", () => {
    expect(micLevelLabel(0)).toBe("Aucun son détecté par le micro");
    expect(micLevelLabel(3)).toBe("Niveau du micro 3 sur 7");
    expect(micLevelLabel(3, 5)).toBe("Niveau du micro 3 sur 5");
  });
});

describe("meet — parole vs silence", () => {
  it("franchit le seuil haut pour passer à « parle »", () => {
    expect(speakingState(false, SPEAKING_ENTER_LEVEL - 0.01)).toBe(false);
    expect(speakingState(false, SPEAKING_ENTER_LEVEL)).toBe(true);
  });

  it("reste « parle » entre les deux seuils (pas de clignotement)", () => {
    const previous = speakingState(false, SPEAKING_ENTER_LEVEL);
    expect(previous).toBe(true);
    const milieu = (SPEAKING_ENTER_LEVEL + SPEAKING_EXIT_LEVEL) / 2;
    expect(speakingState(previous, milieu)).toBe(true);
  });

  it("repart au silence sous le seuil bas", () => {
    const speaking = speakingState(false, 0.9);
    expect(speakingState(speaking, SPEAKING_EXIT_LEVEL + 0.01)).toBe(true);
    expect(speakingState(speaking, SPEAKING_EXIT_LEVEL - 0.01)).toBe(false);
  });

  it("ne réagit pas aux mesures absurdes", () => {
    expect(speakingState(false, Number.NaN)).toBe(false);
    expect(speakingState(true, -5)).toBe(false);
    expect(speakingState(false, 42)).toBe(true);
  });
});
