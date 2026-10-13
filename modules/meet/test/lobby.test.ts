import { describe, expect, it } from "vitest";
import {
  LOBBY_POLL_MS,
  type LobbyStateView,
  lobbyActionIsJoin,
  lobbyActionIsPending,
  lobbyActionLabel,
  lobbyMessage,
  lobbyTitle,
  lobbyTone,
  waitingAnnouncement,
} from "../src/lobby.ts";

const STATES: LobbyStateView[] = ["none", "waiting", "admitted", "denied"];

describe("meet — salle d'attente", () => {
  it("programme un rafraîchissement régulier mais léger", () => {
    expect(LOBBY_POLL_MS).toBeGreaterThan(1000);
    expect(LOBBY_POLL_MS).toBeLessThan(15_000);
  });

  it("propose la bonne action selon l'état", () => {
    expect(lobbyActionLabel("none")).toBe("Demander à entrer");
    expect(lobbyActionLabel("waiting")).toBe("Patienter…");
    expect(lobbyActionLabel("admitted")).toBe("Entrer dans la salle");
    expect(lobbyActionLabel("denied")).toBe("Demander à nouveau");
  });

  it("ne fait entrer que les personnes admises", () => {
    expect(lobbyActionIsJoin("admitted")).toBe(true);
    expect(lobbyActionIsJoin("none")).toBe(false);
    expect(lobbyActionIsJoin("waiting")).toBe(false);
    expect(lobbyActionIsJoin("denied")).toBe(false);
  });

  it("signale une demande en cours d'instruction", () => {
    expect(lobbyActionIsPending("waiting")).toBe(true);
    expect(lobbyActionIsPending("none")).toBe(false);
    expect(lobbyActionIsPending("admitted")).toBe(false);
    expect(lobbyActionIsPending("denied")).toBe(false);
  });

  it("colore chaque état distinctement", () => {
    expect(lobbyTone("admitted")).toBe("success");
    expect(lobbyTone("denied")).toBe("danger");
    expect(lobbyTone("waiting")).toBe("warning");
    expect(lobbyTone("none")).toBe("info");
  });

  it("couvre tous les états sans trou", () => {
    for (const state of STATES) {
      expect(lobbyActionLabel(state)).not.toBe("");
      expect(typeof lobbyActionIsJoin(state)).toBe("boolean");
      expect(typeof lobbyActionIsPending(state)).toBe("boolean");
      expect(["info", "success", "warning", "danger"]).toContain(lobbyTone(state));
    }
  });

  it("accompagne chaque état d'un titre et d'un message en français", () => {
    expect(lobbyTitle("waiting")).toBe("En attente d'admission");
    expect(lobbyTitle("denied")).toBe("Entrée refusée");
    expect(lobbyMessage("waiting")).toContain("organisateur");
    expect(lobbyMessage("denied")).toContain("refusé");
    // Les deux états qui n'ont pas besoin de bandeau restent muets.
    expect(lobbyTitle("none")).toBe("");
    expect(lobbyMessage("none")).toBe("");
  });

  it("compte la file d'attente avec un français correct", () => {
    expect(waitingAnnouncement(0)).toBe("Personne n'attend");
    expect(waitingAnnouncement(1)).toBe("1 personne attend");
    expect(waitingAnnouncement(2)).toBe("2 personnes attendent");
    expect(waitingAnnouncement(12)).toBe("12 personnes attendent");
  });
});
