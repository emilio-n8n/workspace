import { describe, expect, it } from "vitest";
import {
  cameraLabel,
  microphoneLabel,
  type ParticipantState,
  participantLabel,
} from "../src/participant-states.ts";

const state = (overrides: Partial<ParticipantState> = {}): ParticipantState => ({
  name: "Alice",
  local: false,
  microphoneEnabled: true,
  cameraEnabled: true,
  speaking: false,
  ...overrides,
});

describe("meet — états d'un participant", () => {
  it("nomme chaque état dans les deux sens", () => {
    expect(microphoneLabel(true)).toBe("Micro activé");
    expect(microphoneLabel(false)).toBe("Micro coupé");
    expect(cameraLabel(true)).toBe("Caméra activée");
    expect(cameraLabel(false)).toBe("Caméra coupée");
  });

  it("résume une vignette pour les lecteurs d'écran", () => {
    expect(participantLabel(state())).toBe("Alice, Micro activé, Caméra activée");
    expect(participantLabel(state({ microphoneEnabled: false, cameraEnabled: false }))).toBe(
      "Alice, Micro coupé, Caméra coupée",
    );
  });

  it("signale la personne locale comme « vous »", () => {
    expect(participantLabel(state({ local: true }))).toBe(
      "Alice (vous), Micro activé, Caméra activée",
    );
    expect(participantLabel(state({ name: "Bruno", local: false }))).toBe(
      "Bruno, Micro activé, Caméra activée",
    );
  });
});
