import {
  type CollabTokenPayload,
  signCollabToken,
  verifyCollabToken,
} from "@workspace/docs/collab-token";
import { describe, expect, it } from "vitest";
import { messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate } from "y-protocols/sync";
import { shouldAcceptUpdate } from "../src/protocol.ts";

const SECRET = "secret-de-test-suffisamment-long-pour-un-hmac-sha256";
const NOW = 1_800_000_000_000;

function payload(overrides: Partial<CollabTokenPayload> = {}): CollabTokenPayload {
  return {
    fileId: "3f1c0a4e-2b7d-4c9e-8a11-5d6f7b8c9d0e",
    userId: "user-123",
    name: "Camille",
    canWrite: true,
    exp: NOW + 60_000,
    ...overrides,
  };
}

describe("verifyCollabToken", () => {
  it("accepte un jeton signé et restitue la charge utile", () => {
    const input = payload();
    const token = signCollabToken(input, SECRET);
    expect(token.startsWith("v1.")).toBe(true);
    expect(token.split(".")).toHaveLength(3);
    expect(verifyCollabToken(token, SECRET, NOW)).toEqual(input);
  });

  it("refuse un jeton dont la charge utile a été modifiée", () => {
    const token = signCollabToken(payload(), SECRET);
    const [, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify(payload({ canWrite: false })), "utf8").toString(
      "base64url",
    );
    const tampered = `v1.${forged}.${signature}`;
    expect(verifyCollabToken(tampered, SECRET, NOW)).toBeNull();
  });

  it("refuse un jeton dont la signature a été modifiée", () => {
    const token = signCollabToken(payload(), SECRET);
    const [version, encoded, signature] = token.split(".");
    if (!encoded || !signature) throw new Error("format de jeton inattendu");
    const first = signature[0] === "A" ? "B" : "A";
    const tampered = `${version}.${encoded}.${first}${signature.slice(1)}`;
    expect(verifyCollabToken(tampered, SECRET, NOW)).toBeNull();
  });

  it("refuse un secret différent", () => {
    const token = signCollabToken(payload(), SECRET);
    expect(verifyCollabToken(token, `${SECRET}-autre`, NOW)).toBeNull();
  });

  it("refuse les jetons malformés", () => {
    expect(verifyCollabToken("", SECRET, NOW)).toBeNull();
    expect(verifyCollabToken("v1", SECRET, NOW)).toBeNull();
    expect(verifyCollabToken("v1.abc", SECRET, NOW)).toBeNull();
    expect(verifyCollabToken("v2.a.b", SECRET, NOW)).toBeNull();
    expect(verifyCollabToken("v1.a.b.c", SECRET, NOW)).toBeNull();
    expect(verifyCollabToken("v1.!!!.???", SECRET, NOW)).toBeNull();
  });

  it("refuse une charge utile structurellement invalide", () => {
    const wrong = { ...payload(), canWrite: "oui" } as unknown as CollabTokenPayload;
    expect(verifyCollabToken(signCollabToken(wrong, SECRET), SECRET, NOW)).toBeNull();
  });

  it("refuse un jeton expiré (exp en millisecondes)", () => {
    const token = signCollabToken(payload({ exp: NOW - 1 }), SECRET);
    expect(verifyCollabToken(token, SECRET, NOW)).toBeNull();
    // exp == now : expiré (borne inclusive).
    const boundary = signCollabToken(payload({ exp: NOW }), SECRET);
    expect(verifyCollabToken(boundary, SECRET, NOW)).toBeNull();
    // Une milliseconde avant l'expiration : encore valide.
    const alive = signCollabToken(payload({ exp: NOW + 1 }), SECRET);
    expect(verifyCollabToken(alive, SECRET, NOW)).toEqual(payload({ exp: NOW + 1 }));
  });
});

describe("shouldAcceptUpdate", () => {
  it("accepte tous les messages d'un écrivain", () => {
    for (const type of [messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate]) {
      expect(shouldAcceptUpdate(true, type)).toBe(true);
    }
  });

  it("n'accepte que la demande d'état d'un lecteur", () => {
    expect(shouldAcceptUpdate(false, messageYjsSyncStep1)).toBe(true);
    expect(shouldAcceptUpdate(false, messageYjsSyncStep2)).toBe(false);
    expect(shouldAcceptUpdate(false, messageYjsUpdate)).toBe(false);
  });
});
