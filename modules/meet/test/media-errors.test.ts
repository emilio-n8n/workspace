import { describe, expect, it } from "vitest";
import {
  describeMediaError,
  guidanceFor,
  mediaCaptureFailure,
  recognizeMediaError,
} from "../src/media-errors.ts";

/** DOMException n'existe pas en environnement node : on imite sa forme. */
function domError(name: string): Error {
  const error = new Error(`échec ${name}`);
  error.name = name;
  return error;
}

describe("meet — erreurs de périphériques", () => {
  it("classe les exceptions du navigateur", () => {
    expect(recognizeMediaError(domError("NotAllowedError"))).toBe("denied");
    expect(recognizeMediaError(domError("PermissionDeniedError"))).toBe("denied");
    expect(recognizeMediaError(domError("NotFoundError"))).toBe("missing");
    expect(recognizeMediaError(domError("OverconstrainedError"))).toBe("missing");
    expect(recognizeMediaError(domError("NotReadableError"))).toBe("busy");
    expect(recognizeMediaError(domError("TrackStartError"))).toBe("busy");
    expect(recognizeMediaError(domError("SecurityError"))).toBe("insecure");
    expect(recognizeMediaError(domError("NotSupportedError"))).toBe("unsupported");
    expect(recognizeMediaError(domError("TypeError"))).toBe("unsupported");
    expect(recognizeMediaError(domError("Mystère"))).toBe("unknown");
    expect(recognizeMediaError(new Error("sans nom"))).toBe("unknown");
    expect(recognizeMediaError("pas une erreur")).toBe("unknown");
  });

  it("explique un refus de permission avec une action concrète", () => {
    const guidance = describeMediaError("microphone", domError("NotAllowedError"));
    expect(guidance.kind).toBe("denied");
    expect(guidance.title).toBe("Accès au micro refusé");
    expect(guidance.action).toContain("Autorisez l'accès");
    expect(guidance.action).toContain("réessayez");
  });

  it("distingue caméra et micro dans le titre", () => {
    expect(describeMediaError("camera", domError("NotAllowedError")).title).toBe(
      "Accès à la caméra refusé",
    );
    expect(describeMediaError("camera", domError("NotFoundError")).title).toBe(
      "Aucune caméra détectée",
    );
    expect(describeMediaError("microphone", domError("NotFoundError")).title).toBe(
      "Aucun micro détecté",
    );
  });

  it("guide la personne vers la bonne action selon la cause", () => {
    const busy = describeMediaError("microphone", domError("NotReadableError"));
    expect(busy.title).toBe("Micro déjà utilisé");
    expect(busy.action).toContain("Fermez les autres onglets");

    const missing = describeMediaError("camera", domError("NotFoundError"));
    expect(missing.action).toContain("Branchez un périphérique");

    const insecure = describeMediaError("camera", domError("SecurityError"));
    expect(insecure.title).toBe("Connexion non sécurisée");
    expect(insecure.action).toContain("HTTPS");
  });

  it("ne laisse jamais une erreur sans conseil, même inconnue", () => {
    const guidance = describeMediaError("camera", new Error("boum"));
    expect(guidance.kind).toBe("unknown");
    expect(guidance.title).toBe("Caméra indisponible");
    expect(guidance.action).toMatch(/réessayez/);
    expect(guidanceFor("unknown", "output").title).toBe("Sortie audio indisponible");
  });

  it("détecte un navigateur ou un contexte inutilisable", () => {
    expect(mediaCaptureFailure({ mediaDevices: {}, isSecureContext: true })).toBe("unsupported");
    expect(mediaCaptureFailure({ mediaDevices: undefined, isSecureContext: true })).toBe(
      "unsupported",
    );
    expect(
      mediaCaptureFailure({
        mediaDevices: { getUserMedia: () => Promise.resolve({}) },
        isSecureContext: true,
      }),
    ).toBeNull();
    expect(
      mediaCaptureFailure({
        mediaDevices: { getUserMedia: () => Promise.resolve({}) },
        isSecureContext: false,
      }),
    ).toBe("insecure");
  });
});
