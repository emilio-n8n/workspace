import { describe, expect, it } from "vitest";
import {
  formatPublishedDate,
  isPublished,
  publishActionLabel,
  publishStatus,
} from "../src/publish.ts";

describe("sites — état de publication (TASK-005)", () => {
  it("distingue un brouillon d'un site publié", () => {
    expect(isPublished(null)).toBe(false);
    expect(isPublished("2026-03-12T14:05:00.000Z")).toBe(true);
    // Une valeur illisible en base ne fait pas croire à une publication.
    expect(isPublished("pas-une-date")).toBe(false);
    expect(formatPublishedDate("pas-une-date")).toBeNull();
    expect(formatPublishedDate(null)).toBeNull();
  });

  it("formate la date en français, indépendamment du fuseau du client", () => {
    expect(formatPublishedDate("2026-03-12T14:05:00.000Z")).toBe("12 mars 2026 à 14:05");
    expect(formatPublishedDate("2025-01-01T00:00:00.000Z")).toBe("1 janvier 2025 à 00:00");
    expect(formatPublishedDate("2026-12-31T23:59:00.000Z")).toBe("31 décembre 2026 à 23:59");
  });

  it("décrit l'état affiché d'un brouillon", () => {
    const status = publishStatus(null);
    expect(status.label).toBe("Brouillon");
    expect(status.tone).toBe("default");
    expect(status.detail).toContain("pas en ligne");
  });

  it("décrit l'état affiché d'un site publié, avec sa date", () => {
    const status = publishStatus("2026-03-12T14:05:00.000Z");
    expect(status.label).toBe("Publié");
    expect(status.tone).toBe("accent");
    expect(status.detail).toBe("En ligne depuis le 12 mars 2026 à 14:05 (UTC).");
  });

  it("propose le bon libellé d'action selon l'état", () => {
    expect(publishActionLabel(null)).toBe("Publier");
    expect(publishActionLabel("2026-03-12T14:05:00.000Z")).toBe("Republier");
  });
});
