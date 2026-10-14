import { describe, expect, it } from "vitest";
import {
  presentationExitMessage,
  presentationHelp,
  presentationLabel,
  presentationProgress,
  presentationShouldContinue,
  presentationSummary,
} from "../src/slide-presentation.ts";

const CONTAINER = { id: "scene" };

describe("slides — mode présentation en plein écran", () => {
  it("continue à présenter quand le plein écran n'a pas été demandé", () => {
    expect(
      presentationShouldContinue({
        requested: false,
        fullscreenElement: null,
        container: CONTAINER,
      }),
    ).toBe(true);
  });

  it("continue à présenter quand notre conteneur est en plein écran", () => {
    expect(
      presentationShouldContinue({
        requested: true,
        fullscreenElement: CONTAINER,
        container: CONTAINER,
      }),
    ).toBe(true);
  });

  it("arrête de présenter quand l'utilisateur quitte le plein écran (Échap)", () => {
    expect(
      presentationShouldContinue({
        requested: true,
        fullscreenElement: null,
        container: CONTAINER,
      }),
    ).toBe(false);
  });

  it("arrête de présenter si le plein écran porte sur un autre élément", () => {
    expect(
      presentationShouldContinue({
        requested: true,
        fullscreenElement: { id: "ailleurs" },
        container: CONTAINER,
      }),
    ).toBe(false);
  });
});

describe("slides — libellés du mode présentation", () => {
  it("annonce la position avec l'accord du pluriel", () => {
    expect(presentationLabel(0, 1)).toBe("Diapositive 1 sur 1.");
    expect(presentationLabel(2, 10)).toBe("Diapositive 3 sur 10.");
    expect(presentationLabel(9, 10)).toBe("Diapositive 10 sur 10.");
  });

  it("résume le nombre de diapositives", () => {
    expect(presentationSummary(1)).toBe("1 diapositive");
    expect(presentationSummary(4)).toBe("4 diapositives");
    expect(presentationSummary(0)).toBe("0 diapositive");
  });

  it("borne l'avancement et évite les divisions par zéro", () => {
    expect(presentationProgress(0, 10)).toBe(10);
    expect(presentationProgress(4, 10)).toBe(50);
    expect(presentationProgress(9, 10)).toBe(100);
    expect(presentationProgress(0, 0)).toBe(0);
    // Un index hors bornes est ramené à une diapositive existante.
    expect(presentationProgress(-3, 5)).toBe(20);
    expect(presentationProgress(99, 5)).toBe(100);
  });

  it("rappelle les raccourcis et la sortie en français", () => {
    expect(presentationHelp()).toContain("Échap");
    expect(presentationExitMessage()).toBe("Mode présentation terminé.");
  });
});
