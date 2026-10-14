import { describe, expect, it } from "vitest";
import {
  CHAT_MAX_LENGTH,
  chatBodyLength,
  countUnread,
  formatMessageTime,
  messageAnnouncement,
  messagePreview,
  unreadLabel,
  validateChatBody,
} from "../src/chat.ts";

describe("meet — validation des messages", () => {
  it("nettoie les espaces autour d'un message valide", () => {
    expect(validateChatBody("  Bonjour tout le monde  ")).toEqual({
      ok: true,
      body: "Bonjour tout le monde",
    });
  });

  it("refuse un message vide ou seulement composé d'espaces", () => {
    expect(validateChatBody("")).toEqual({
      ok: false,
      error: "Écrivez un message avant de l'envoyer.",
    });
    expect(validateChatBody("   \n  ").ok).toBe(false);
  });

  it("refuse un message plus long que la limite, en comptant les points de code", () => {
    expect(validateChatBody("x".repeat(CHAT_MAX_LENGTH)).ok).toBe(true);
    const tooLong = validateChatBody("x".repeat(CHAT_MAX_LENGTH + 1));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.error).toBe(`Message trop long (${CHAT_MAX_LENGTH} caractères maximum).`);
    }
  });

  it("compte les caractères par point de code (accents et émojis)", () => {
    expect(chatBodyLength("café")).toBe(4);
    expect(chatBodyLength("🙂🙂")).toBe(2);
  });
});

describe("meet — aperçus et horodatage", () => {
  it("réduit les espaces et tronque proprement un aperçu", () => {
    expect(messagePreview("  Bonjour\n\n  à tous  ")).toBe("Bonjour à tous");
    const long = messagePreview("a".repeat(200));
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(121);
  });

  it("formate une heure valide et ignore une date invalide", () => {
    expect(formatMessageTime("2026-02-03T14:05:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
    expect(formatMessageTime("pas une date")).toBe("");
  });

  it("compose une annonce de message lisible", () => {
    expect(messageAnnouncement("Alice", "  Bonjour  ")).toBe("Message de Alice : Bonjour");
  });
});

describe("meet — messages non lus", () => {
  const own = { createdAt: "2026-02-03T10:00:03.000Z", own: true };
  const other = { createdAt: "2026-02-03T10:00:02.000Z", own: false };
  const old = { createdAt: "2026-02-03T09:00:00.000Z", own: false };

  it("compte les messages des autres quand rien n'a encore été lu", () => {
    expect(countUnread([own, other, old], null)).toBe(2);
  });

  it("ne compte jamais ses propres messages", () => {
    expect(countUnread([own], null)).toBe(0);
  });

  it("ne compte que les messages postérieurs au repère de lecture", () => {
    expect(countUnread([own, other, old], "2026-02-03T10:00:01.000Z")).toBe(1);
    expect(countUnread([own, other, old], "2026-02-03T10:00:03.000Z")).toBe(0);
  });

  it("libelle le compteur en français", () => {
    expect(unreadLabel(0)).toBe("Aucun message non lu");
    expect(unreadLabel(1)).toBe("1 message non lu");
    expect(unreadLabel(4)).toBe("4 messages non lus");
  });
});
