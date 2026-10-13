import { describe, expect, it } from "vitest";
import {
  daysLate,
  dueDateInputToIso,
  fmtSize,
  formatDate,
  formatDateTime,
  formatDueDate,
  toDateInputValue,
} from "../src/ui/format.ts";

describe("classroom — dates affichées", () => {
  it("formate en français et garde le silence sur une valeur absente", () => {
    expect(formatDate("2026-10-12T23:59:00.000Z")).toMatch(/12 oct\. 2026/);
    expect(formatDate(null)).toBeNull();
    expect(formatDate("pas-une-date")).toBeNull();
    // L'échéance manquante se dit, elle ne se devine pas.
    expect(formatDueDate(null)).toBe("sans échéance");
    expect(formatDueDate("2026-10-12T23:59:00.000Z")).toMatch(/12 oct\. 2026/);
  });

  it("affiche l'heure d'une remise", () => {
    expect(formatDateTime("2026-10-12T23:59:00.000Z")).toMatch(/12 oct\. 2026 à \d{2}:\d{2}/);
    expect(formatDateTime(null)).toBeNull();
  });

  it("fait l'aller-retour avec le champ de date du formulaire", () => {
    const value = toDateInputValue("2026-10-12T23:59:00.000Z");
    // Le jour affiché est le jour local de l'utilisateur, pas la date UTC.
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const iso = dueDateInputToIso(value);
    expect(iso).not.toBeNull();
    // Une échéance saisie court jusqu'à la fin de la journée.
    expect(iso).toMatch(/T23:59:00\.000Z$/);
    // Champ vide ou illisible : pas d'échéance, pas de date inventée.
    expect(dueDateInputToIso("")).toBeNull();
    expect(toDateInputValue(null)).toBe("");
    expect(dueDateInputToIso("2026-13-45")).toBeNull();
  });

  it("compte le retard en jours entiers, jamais en négatif", () => {
    expect(daysLate("2026-10-12T22:00:00.000Z", "2026-10-12T23:59:00.000Z")).toBeNull();
    expect(daysLate("2026-10-13T00:30:00.000Z", "2026-10-12T23:59:00.000Z")).toBe(1);
    expect(daysLate("2026-10-15T09:00:00.000Z", "2026-10-12T23:59:00.000Z")).toBe(3);
    // Sans échéance, pas de retard.
    expect(daysLate("2026-10-13T00:30:00.000Z", null)).toBeNull();
  });
});

describe("classroom — tailles de fichiers", () => {
  it("passe des octets aux unités binaires", () => {
    expect(fmtSize(512)).toBe("512 o");
    expect(fmtSize(2048)).toBe("2.0 Ko");
    expect(fmtSize(5 * 1024 * 1024)).toBe("5.0 Mo");
  });
});
