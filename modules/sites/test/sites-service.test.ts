import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addPage,
  createSite,
  deletePage,
  getPage,
  getSite,
  listSites,
  renameSite,
  SITES_MIME,
  SitesError,
  savePage,
} from "../src/index.ts";

const { user, organization, auditEvents } = coreSchema;

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
  await db.delete(auditEvents).where(eq(auditEvents.orgId, f.orgId));
  await db.delete(auditEvents).where(eq(auditEvents.orgId, f.otherOrgId));
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  await db.delete(user).where(eq(user.id, f.actorAlice.userId));
  await db.delete(user).where(eq(user.id, f.actorBruno.userId));
  await db.delete(user).where(eq(user.id, f.actorChloe.userId));
}

/** Nombre de lignes d'audit rattachées à une organisation. */
async function countAuditRows(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(auditEvents)
    .where(eq(auditEvents.orgId, orgId));
  return row?.value ?? 0;
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

describe("sites — cycle de vie", () => {
  it("crée un site lié avec une page d'accueil", async () => {
    const { entry } = await createSite(f.actorAlice, { title: "Intranet" });
    expect(entry.mimeType).toBe(SITES_MIME);

    const site = await getSite(f.actorAlice, entry.id);
    expect(site.pages).toHaveLength(1);
    expect(site.pages[0]?.slug).toBe("accueil");
    expect(site.canEdit).toBe(true);

    expect(await listSites(f.actorBruno)).toHaveLength(0);
    // Un acteur hors organisation obtient une erreur Sites, pas un détail Drive.
    await expect(getSite(f.actorChloe, entry.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("ajoute des pages avec slugs uniques et refuse la suppression de la dernière", async () => {
    const { entry } = await createSite(f.actorAlice, { title: "Docs internes" });
    const first = await getSite(f.actorAlice, entry.id);
    const home = first.pages[0];
    if (!home) throw new Error("page manquante");

    const added = await addPage(f.actorAlice, entry.id, { title: "Guide d'accueil" });
    expect(added.pages).toHaveLength(2);
    const duplicate = await addPage(f.actorAlice, entry.id, { title: "Guide d'accueil" });
    const slugs = duplicate.pages.map((page) => page.slug);
    expect(slugs).toContain("guide-d-accueil");
    expect(slugs).toContain("guide-d-accueil-2");
    // `count(*)` produisait des positions dupliquées après une suppression.
    expect(new Set(duplicate.pages.map((page) => page.position)).size).toBe(3);

    const firstGuide = duplicate.pages.find((page) => page.slug === "guide-d-accueil");
    const secondGuide = duplicate.pages.find((page) => page.slug === "guide-d-accueil-2");
    if (!firstGuide || !secondGuide) throw new Error("page manquante");
    await deletePage(f.actorAlice, entry.id, firstGuide.id);
    await deletePage(f.actorAlice, entry.id, secondGuide.id);

    // La dernière page est protégée et reste bien en base.
    await expect(deletePage(f.actorAlice, entry.id, home.id)).rejects.toMatchObject({
      code: "validation",
    });
    const reloaded = await getSite(f.actorAlice, entry.id);
    expect(reloaded.pages).toHaveLength(1);
    expect(reloaded.pages[0]?.id).toBe(home.id);
  });

  it("crée en parallèle des pages aux titres identiques sans collision de slug", async () => {
    const { entry } = await createSite(f.actorAlice, { title: "Concurrence" });

    const results = await Promise.all([
      addPage(f.actorAlice, entry.id, { title: "Doublon" }),
      addPage(f.actorAlice, entry.id, { title: "Doublon" }),
      addPage(f.actorAlice, entry.id, { title: "Doublon" }),
    ]);
    expect(results).toHaveLength(3);

    const site = await getSite(f.actorAlice, entry.id);
    const slugs = site.pages
      .filter((page) => page.slug.startsWith("doublon"))
      .map((page) => page.slug);
    expect(slugs).toHaveLength(3);
    expect(new Set(slugs).size).toBe(3);
    expect(slugs).toEqual(expect.arrayContaining(["doublon", "doublon-2", "doublon-3"]));
  });

  it("enregistre titre et contenu d'une page en conservant son slug", async () => {
    const { entry } = await createSite(f.actorAlice, { title: "Wiki" });
    const site = await getSite(f.actorAlice, entry.id);
    const page = site.pages[0];
    if (!page) throw new Error("page manquante");

    await savePage(f.actorAlice, entry.id, page.id, {
      title: "Accueil V2",
      content: "# Accueil V2\n\nBienvenue.",
    });
    const reloaded = await getPage(f.actorAlice, entry.id, page.id);
    expect(reloaded.title).toBe("Accueil V2");
    expect(reloaded.content).toContain("Bienvenue.");
    // Le slug ne change pas au renommage : les liens externes restent valides.
    expect(reloaded.slug).toBe(page.slug);
  });

  it("refuse une page appartenant à un autre site", async () => {
    const siteA = await createSite(f.actorAlice, { title: "Site A" });
    const siteB = await createSite(f.actorAlice, { title: "Site B" });
    const pageB = (await getSite(f.actorAlice, siteB.entry.id)).pages[0];
    if (!pageB) throw new Error("page manquante");

    expect((await getPage(f.actorAlice, siteB.entry.id, pageB.id)).id).toBe(pageB.id);
    await expect(getPage(f.actorAlice, siteA.entry.id, pageB.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuse les modifications sans droit", async () => {
    const { entry } = await createSite(f.actorAlice, { title: "Protégé" });
    const site = await getSite(f.actorAlice, entry.id);
    const page = site.pages[0];
    if (!page) throw new Error("page manquante");

    await expect(
      savePage(f.actorBruno, entry.id, page.id, { title: "Voleur", content: "x" }),
    ).rejects.toThrow(SitesError);
    await expect(addPage(f.actorBruno, entry.id, { title: "Triche" })).rejects.toThrow(SitesError);
    await expect(deletePage(f.actorBruno, entry.id, page.id)).rejects.toThrow(SitesError);
  });
});

describe("sites — audit", () => {
  it("journalise la création du site et les opérations de page", async () => {
    const { entry } = await createSite(f.actorAlice, { title: "Audit" });
    const site = await getSite(f.actorAlice, entry.id);
    const home = site.pages[0];
    if (!home) throw new Error("page manquante");

    const added = await addPage(f.actorAlice, entry.id, { title: "Journal" });
    await savePage(f.actorAlice, entry.id, added.pageId, {
      title: "Journal",
      content: "# Journal\n",
    });
    await deletePage(f.actorAlice, entry.id, added.pageId);

    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    const byAction = new Map(rows.map((row) => [row.action, row]));

    expect(byAction.get("sites.site.create")).toMatchObject({
      actorUserId: f.actorAlice.userId,
      resourceType: "site",
      resourceId: entry.id,
      result: "success",
    });
    for (const action of ["sites.page.add", "sites.page.save", "sites.page.delete"]) {
      const row = byAction.get(action);
      expect(row).toMatchObject({
        actorUserId: f.actorAlice.userId,
        resourceType: "site",
        resourceId: entry.id,
        result: "success",
      });
      expect(row?.metadata).toEqual({ pageId: added.pageId });
    }
    // La suppression de la page d'accueil est impossible : une seule page reste.
    expect((await getSite(f.actorAlice, entry.id)).pages).toHaveLength(1);
  });

  it("ne journalise ni la consultation ni le renommage (non notable)", async () => {
    const { entry } = await createSite(f.actorAlice, { title: "Sans audit" });

    // Consultation : jamais journalisée, le compte global de l'organisation
    // reste inchangé.
    const before = await countAuditRows(f.orgId);
    await getSite(f.actorAlice, entry.id);
    await listSites(f.actorAlice);
    expect(await countAuditRows(f.orgId)).toBe(before);

    // Renommage : délégué à Drive, qui journalise `drive.entry.rename` de son
    // côté ; Sites n'ajoute aucune ligne `sites.*` (mutation non notable).
    const siteAuditRows = async () =>
      (await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId))).filter(
        (row) => row.action.startsWith("sites."),
      );
    const beforeRename = (await siteAuditRows()).length;
    await renameSite(f.actorAlice, entry.id, "Renommé");
    expect((await siteAuditRows()).length).toBe(beforeRename);
  });
});
