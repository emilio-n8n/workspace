import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTab,
  createSpreadsheet,
  csvCell,
  deleteTab,
  exportSpreadsheetCsv,
  getSpreadsheet,
  importCsv,
  listSpreadsheets,
  MAX_TABS,
  renameTab,
  SHEETS_MIME,
  SheetsError,
  saveCells,
} from "../src/index.ts";

const { user, organization } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  otherOrgId: string;
  actorAlice: Actor;
  actorBruno: Actor;
  actorChloe: Actor;
};

async function createFixtures(): Promise<Fixtures> {
  const db = getDb();
  const now = new Date();

  const orgId = tag("org");
  const otherOrgId = tag("org");
  await db.insert(organization).values([
    { id: orgId, name: tag("Org "), slug: orgId, createdAt: now },
    { id: otherOrgId, name: tag("Org "), slug: otherOrgId, createdAt: now },
  ]);

  const makeUser = async (name: string) => {
    const id = tag("usr");
    await db.insert(user).values({
      id,
      name,
      email: `${id}@example.org`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  };

  const alice = await makeUser("Alice");
  const bruno = await makeUser("Bruno");
  const chloe = await makeUser("Chloe");

  return {
    orgId,
    otherOrgId,
    actorAlice: { userId: alice, orgId },
    actorBruno: { userId: bruno, orgId },
    actorChloe: { userId: chloe, orgId: otherOrgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  await db.delete(user).where(eq(user.id, f.actorAlice.userId));
  await db.delete(user).where(eq(user.id, f.actorBruno.userId));
  await db.delete(user).where(eq(user.id, f.actorChloe.userId));
}

let f: Fixtures;

beforeEach(async () => {
  f = await createFixtures();
});

afterEach(async () => {
  await cleanup(f);
});

afterAll(async () => {
  await closeDb();
});

describe("sheets — cycle de vie", () => {
  it("crée une feuille liée avec un onglet par défaut", async () => {
    const { entry, spreadsheet } = await createSpreadsheet(f.actorAlice, { title: "Budget" });
    expect(entry.mimeType).toBe(SHEETS_MIME);

    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    expect(detail.tabs).toHaveLength(1);
    expect(detail.tabs[0]?.name).toBe("Feuille 1");
    expect(detail.canEdit).toBe(true);
    expect(spreadsheet.id).toBeTruthy();

    const list = await listSpreadsheets(f.actorAlice);
    expect(list.some((sheet) => sheet.fileId === entry.id)).toBe(true);
    expect(await listSpreadsheets(f.actorBruno)).toHaveLength(0);
  });

  it("sauvegarde, met à jour et efface des cellules", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Notes" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    await saveCells(f.actorAlice, entry.id, {
      tabId,
      updates: [
        { row: 0, col: 0, value: "2" },
        { row: 1, col: 0, value: "3" },
        { row: 2, col: 0, value: "=SUM(A1:A2)" },
      ],
    });
    let refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(refreshed.cells).toHaveLength(3);

    await saveCells(f.actorAlice, entry.id, {
      tabId,
      updates: [
        { row: 1, col: 0, value: "10" },
        { row: 2, col: 0, value: "" },
      ],
    });
    refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(refreshed.cells.find((cell) => cell.row === 1)?.value).toBe("10");
    expect(refreshed.cells.find((cell) => cell.row === 2)).toBeUndefined();
    expect(refreshed.truncated).toBe(false);
  });

  it("dédoublonne les mises à jour, la dernière gagne", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Dédoublonnage" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    // La cellule (ligne 1, colonne 0) finit effacée ; la 2500e valeur gagne sur la première.
    const many = Array.from({ length: 2500 }, (_, index) => ({
      row: 0,
      col: 0,
      value: String(index),
    }));
    const result = await saveCells(f.actorAlice, entry.id, {
      tabId,
      updates: [
        { row: 0, col: 0, value: "1" },
        { row: 0, col: 0, value: "" },
        ...many,
        { row: 1, col: 0, value: "3" },
        { row: 1, col: 0, value: "" },
      ],
    });
    expect(result.saved).toBe(2);

    const refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(refreshed.cells).toHaveLength(1);
    expect(refreshed.cells[0]?.value).toBe("2499");
    expect(refreshed.cells[0]?.row).toBe(0);

    // 2 001 cellules distinctes : la limite s'applique bien après dédoublonnage.
    const distinct = Array.from({ length: 2001 }, (_, index) => ({
      row: Math.floor(index / 100),
      col: index % 100,
      value: "x",
    }));
    await expect(saveCells(f.actorAlice, entry.id, { tabId, updates: distinct })).rejects.toThrow(
      SheetsError,
    );
  });

  it("sauvegarde par lots de plus de 500 cellules", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Gros lot" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    const updates = Array.from({ length: 1200 }, (_, index) => ({
      row: Math.floor(index / 100),
      col: index % 100,
      value: `v${index}`,
    }));
    const result = await saveCells(f.actorAlice, entry.id, { tabId, updates });
    expect(result.saved).toBe(1200);

    const refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(refreshed.cells).toHaveLength(1200);
    expect(refreshed.cells.find((cell) => cell.row === 11 && cell.col === 99)?.value).toBe("v1199");
  });

  it("signale la troncature au-delà de 50 000 cellules", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Troncature" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    const total = 50_001;
    for (let offset = 0; offset < total; offset += 2000) {
      const updates = Array.from({ length: Math.min(offset + 2000, total) - offset }, (_, step) => {
        const index = offset + step;
        return { row: Math.floor(index / 100), col: index % 100, value: `v${index}` };
      });
      await saveCells(f.actorAlice, entry.id, { tabId, updates });
    }

    const refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(refreshed.cells).toHaveLength(50_000);
    expect(refreshed.truncated).toBe(true);
  }, 60_000);

  it("trie les cellules par onglet, ligne et colonne", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Ordre" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    await saveCells(f.actorAlice, entry.id, {
      tabId,
      updates: [
        { row: 2, col: 1, value: "c" },
        { row: 0, col: 2, value: "b" },
        { row: 0, col: 0, value: "a" },
      ],
    });

    const refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(refreshed.cells.map((cell) => [cell.row, cell.col])).toEqual([
      [0, 0],
      [0, 2],
      [2, 1],
    ]);
  });

  it("refuse la modification par un membre sans droit et l'onglet d'une autre feuille", async () => {
    const first = await createSpreadsheet(f.actorAlice, { title: "A" });
    const second = await createSpreadsheet(f.actorAlice, { title: "B" });
    const secondDetail = await getSpreadsheet(f.actorAlice, second.entry.id);
    const secondTab = secondDetail.tabs[0]?.id;
    if (!secondTab) throw new Error("onglet manquant");

    const firstDetail = await getSpreadsheet(f.actorAlice, first.entry.id);
    const firstTab = firstDetail.tabs[0]?.id;
    if (!firstTab) throw new Error("onglet manquant");

    await expect(
      saveCells(f.actorBruno, first.entry.id, {
        tabId: firstTab,
        updates: [{ row: 0, col: 0, value: "x" }],
      }),
    ).rejects.toThrow(SheetsError);

    await expect(
      saveCells(f.actorAlice, first.entry.id, {
        tabId: secondTab,
        updates: [{ row: 0, col: 0, value: "x" }],
      }),
    ).rejects.toThrow(SheetsError);

    await expect(getSpreadsheet(f.actorChloe, first.entry.id)).rejects.toThrow(SheetsError);
  });
});

describe("sheets — onglets", () => {
  it("ajoute, renomme et empêche la suppression du dernier onglet", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Onglets" });
    let detail = await getSpreadsheet(f.actorAlice, entry.id);
    const firstTab = detail.tabs[0]?.id;
    if (!firstTab) throw new Error("onglet manquant");

    const tabs = await addTab(f.actorAlice, entry.id, "Dépenses");
    expect(tabs).toHaveLength(2);

    detail = await getSpreadsheet(f.actorAlice, entry.id);
    const secondTab = detail.tabs[1]?.id;
    if (!secondTab) throw new Error("onglet manquant");
    await deleteTab(f.actorAlice, secondTab);
    await expect(deleteTab(f.actorAlice, firstTab)).rejects.toThrow(SheetsError);
  });

  it("refuse de supprimer le dernier onglet et le conserve", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Dernier onglet" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const onlyTab = detail.tabs[0]?.id;
    if (!onlyTab) throw new Error("onglet manquant");

    await expect(deleteTab(f.actorAlice, onlyTab)).rejects.toThrow(SheetsError);

    const after = await getSpreadsheet(f.actorAlice, entry.id);
    expect(after.tabs).toHaveLength(1);
    expect(after.tabs[0]?.id).toBe(onlyTab);
  });

  it("renomme un onglet et valide le nom", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Renommage" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    await renameTab(f.actorAlice, tabId, "  Budget 2026  ");
    const renamed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(renamed.tabs[0]?.name).toBe("Budget 2026");

    await expect(renameTab(f.actorAlice, tabId, "   ")).rejects.toThrow(SheetsError);
    await expect(renameTab(f.actorBruno, tabId, "Vol ")).rejects.toThrow(SheetsError);
  });

  it("sérialise les ajouts simultanés au-delà de la limite d'onglets", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Course onglets" });
    const attempts = MAX_TABS + 5;

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, index) =>
        addTab(f.actorAlice, entry.id, `Onglet ${index}`),
      ),
    );
    const added = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    // « Feuille 1 » existe déjà : il reste MAX_TABS - 1 ajouts possibles.
    expect(added).toHaveLength(MAX_TABS - 1);
    expect(rejected).toHaveLength(attempts - (MAX_TABS - 1));
    expect(rejected.every((result) => result.reason instanceof SheetsError)).toBe(true);

    const refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(refreshed.tabs).toHaveLength(MAX_TABS);
  }, 60_000);
});

describe("sheets — export CSV", () => {
  it("exporte les valeurs calculées", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Export" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    await saveCells(f.actorAlice, entry.id, {
      tabId,
      updates: [
        { row: 0, col: 0, value: "2" },
        { row: 1, col: 0, value: "3" },
        { row: 2, col: 0, value: "=SUM(A1:A2)" },
        { row: 0, col: 1, value: "Nom, prénom" },
      ],
    });

    const csv = await exportSpreadsheetCsv(f.actorAlice, entry.id, tabId);
    expect(csv.contentType).toBe("text/csv; charset=utf-8");
    expect(csv.body).toContain("5");
    expect(csv.body).toContain('"Nom, prénom"');
    expect(csv.body.startsWith("\uFEFF")).toBe(true);
  });

  it("neutralise l'injection de formule dans les cellules exportées", async () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+cmd|' /C calc'!A0")).toBe(`'+cmd|' /C calc'!A0`);
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@import")).toBe("'@import");
    expect(csvCell("\tligne")).toBe("'\tligne");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');

    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Injection" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    await saveCells(f.actorAlice, entry.id, {
      tabId,
      updates: [
        { row: 0, col: 0, value: "@SUM(A1)" },
        { row: 0, col: 1, value: "=1-2" },
      ],
    });

    const csv = await exportSpreadsheetCsv(f.actorAlice, entry.id, tabId);
    expect(csv.body).toContain("'@SUM(A1)");
    expect(csv.body).toContain("'-1");
  });
});

describe("sheets — import CSV", () => {
  it("remplace le contenu existant de l'onglet", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Import" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    await saveCells(f.actorAlice, entry.id, {
      tabId,
      updates: [
        { row: 0, col: 0, value: "ancien" },
        { row: 5, col: 3, value: "42" },
        { row: 99, col: 99, value: "obsolète" },
      ],
    });

    const result = await importCsv(f.actorAlice, entry.id, {
      tabId,
      text: 'Nom,Prénom\r\n"Dupont, Jean",Jean\nvaleur,3',
    });
    expect(result.imported).toBe(6);

    const refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(refreshed.cells).toEqual([
      { tabId, row: 0, col: 0, value: "Nom" },
      { tabId, row: 0, col: 1, value: "Prénom" },
      { tabId, row: 1, col: 0, value: "Dupont, Jean" },
      { tabId, row: 1, col: 1, value: "Jean" },
      { tabId, row: 2, col: 0, value: "valeur" },
      { tabId, row: 2, col: 1, value: "3" },
    ]);
  });

  it("ignore les lignes vides du texte importé", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Import lignes vides" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    const result = await importCsv(f.actorAlice, entry.id, {
      tabId,
      text: "a\n\nb\n\n",
    });
    expect(result.imported).toBe(2);

    const refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(refreshed.cells.map((cell) => ({ row: cell.row, value: cell.value }))).toEqual([
      { row: 0, value: "a" },
      { row: 1, value: "b" },
    ]);
  });

  it("n'écrit que dans l'onglet ciblé", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Onglets import" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const firstTab = detail.tabs[0]?.id;
    if (!firstTab) throw new Error("onglet manquant");

    const tabs = await addTab(f.actorAlice, entry.id, "Cible");
    const secondTab = tabs[1]?.id;
    if (!secondTab) throw new Error("onglet manquant");

    await saveCells(f.actorAlice, entry.id, {
      tabId: firstTab,
      updates: [{ row: 0, col: 0, value: "conservé" }],
    });
    await saveCells(f.actorAlice, entry.id, {
      tabId: secondTab,
      updates: [{ row: 0, col: 0, value: "remplacé" }],
    });

    await importCsv(f.actorAlice, entry.id, { tabId: secondTab, text: "cible" });

    const refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    const first = refreshed.cells.filter((cell) => cell.tabId === firstTab);
    const second = refreshed.cells.filter((cell) => cell.tabId === secondTab);
    expect(first.map((cell) => cell.value)).toEqual(["conservé"]);
    expect(second.map((cell) => cell.value)).toEqual(["cible"]);
  });

  it("refuse un import vide ou par un membre sans droit", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Import refusé" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    await expect(importCsv(f.actorAlice, entry.id, { tabId, text: "" })).rejects.toThrow(
      "Aucune donnée à importer",
    );
    await expect(importCsv(f.actorAlice, entry.id, { tabId, text: "\n\r\n" })).rejects.toThrow(
      "Aucune donnée à importer",
    );

    await saveCells(f.actorAlice, entry.id, {
      tabId,
      updates: [{ row: 0, col: 0, value: "avant" }],
    });
    await expect(importCsv(f.actorBruno, entry.id, { tabId, text: "x,y" })).rejects.toThrow(
      SheetsError,
    );

    // Un import refusé laisse le contenu intact.
    const refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(refreshed.cells.map((cell) => cell.value)).toEqual(["avant"]);
  });

  it("valide le plafond de 20 000 cellules", async () => {
    const { entry } = await createSpreadsheet(f.actorAlice, { title: "Import volumineux" });
    const detail = await getSpreadsheet(f.actorAlice, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");

    const rows = 201;
    const cells = 100;
    const text = Array.from({ length: rows }, () =>
      Array.from({ length: cells }, () => "x").join(","),
    ).join("\n");
    await expect(importCsv(f.actorAlice, entry.id, { tabId, text })).rejects.toThrow(
      /Import limité à 20\s?000 cellules\./,
    );

    const refreshed = await getSpreadsheet(f.actorAlice, entry.id);
    expect(refreshed.cells).toHaveLength(0);
  });
});
