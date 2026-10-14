import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addPage,
  createSite,
  deletePage,
  getSite,
  movePage,
  publishSite,
  SitesError,
  saveNavigation,
  unpublishSite,
} from "../src/index.ts";
import type { NavigationItem } from "../src/navigation.ts";
import { sitesSites } from "../src/schema.ts";

const { user, organization, auditEvents } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  actorAlice: Actor;
  actorBruno: Actor;
};

async function createFixtures(): Promise<Fixtures> {
  const db = getDb();
  const now = new Date();
  const orgId = tag("org");
  await db
    .insert(organization)
    .values([{ id: orgId, name: tag("Org "), slug: orgId, createdAt: now }]);

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

  return {
    orgId,
    actorAlice: { userId: alice, orgId },
    actorBruno: { userId: bruno, orgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(auditEvents).where(eq(auditEvents.orgId, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(user).where(eq(user.id, f.actorAlice.userId));
  await db.delete(user).where(eq(user.id, f.actorBruno.userId));
}

/** Nombre de lignes d'audit d'une action donnée. */
async function auditRows(orgId: string, action: string) {
  return (await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, orgId))).filter(
    (row) => row.action === action,
  );
}

/** Un site neuf, brouillon, avec sa page d'accueil. */
async function createSiteFixture() {
  const { entry } = await createSite(f.actorAlice, { title: tag("Site") });
  const site = await getSite(f.actorAlice, entry.id);
  return { fileId: entry.id, home: site.pages[0]!, pages: site.pages };
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

describe("sites — publication (TASK-005)", () => {
  it("publie un site en renseignant la date et l'auteur", async () => {
    const { fileId } = await createSiteFixture();
    const brouillon = await getSite(f.actorAlice, fileId);
    expect(brouillon.publishedAt).toBeNull();
    expect(brouillon.publishedBy).toBeNull();

    const publie = await publishSite(f.actorAlice, fileId);
    expect(publie.publishedBy).toBe(f.actorAlice.userId);
    expect(publie.publishedAt).not.toBeNull();
    expect(new Date(publie.publishedAt as string).getTime()).toBeGreaterThan(0);

    // La valeur est bien persistée, pas seulement renvoyée.
    const relu = await getSite(f.actorAlice, fileId);
    expect(relu.publishedAt).toBe(publie.publishedAt);
    expect(relu.publishedBy).toBe(publie.publishedBy);
    expect(relu.canEdit).toBe(true);
  });

  it("republie en remettant la date à jour", async () => {
    const { fileId } = await createSiteFixture();
    const premier = await publishSite(f.actorAlice, fileId);
    // La date est écrite par la base : on la recule pour voir la republication.
    await getDb()
      .update(sitesSites)
      .set({ publishedAt: sql`now() - interval '30 days'` })
      .where(eq(sitesSites.fileId, fileId));

    const second = await publishSite(f.actorAlice, fileId);
    expect(new Date(second.publishedAt as string).getTime()).toBeGreaterThan(
      new Date(premier.publishedAt as string).getTime(),
    );
  });

  it("dépublie un site : ni date ni auteur ne subsistent", async () => {
    const { fileId } = await createSiteFixture();
    await publishSite(f.actorAlice, fileId);

    const brouillon = await unpublishSite(f.actorAlice, fileId);
    expect(brouillon.publishedAt).toBeNull();
    expect(brouillon.publishedBy).toBeNull();

    const relu = await getSite(f.actorAlice, fileId);
    expect(relu.publishedAt).toBeNull();
    expect(relu.publishedBy).toBeNull();
  });

  it("journalise la publication et la dépublication", async () => {
    const { fileId } = await createSiteFixture();
    await publishSite(f.actorAlice, fileId);
    await unpublishSite(f.actorAlice, fileId);

    for (const action of ["sites.site.publish", "sites.site.unpublish"]) {
      const rows = await auditRows(f.orgId, action);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorUserId: f.actorAlice.userId,
        resourceType: "site",
        resourceId: fileId,
        result: "success",
      });
    }
  });

  it("refuse de publier sans droit d'écriture", async () => {
    const { fileId } = await createSiteFixture();
    await expect(publishSite(f.actorBruno, fileId)).rejects.toThrow(SitesError);
    expect((await getSite(f.actorAlice, fileId)).publishedAt).toBeNull();

    await publishSite(f.actorAlice, fileId);
    await expect(unpublishSite(f.actorBruno, fileId)).rejects.toThrow(SitesError);
    expect((await getSite(f.actorAlice, fileId)).publishedAt).not.toBeNull();
  });

  it("n'expose pas l'état de publication d'un site inconnu", async () => {
    await expect(
      getSite(f.actorAlice, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      publishSite(f.actorAlice, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("sites — ordre des pages et menu (TASK-006)", () => {
  it("déplace une page dans les deux sens, menu compris", async () => {
    const { entry } = await createSite(f.actorAlice, { title: tag("Ordre") });
    const fileId = entry.id;
    const added = await addPage(f.actorAlice, fileId, { title: "Journal" });
    const ajoutee = await addPage(f.actorAlice, fileId, { title: "Contact" });
    expect(added.pages.map((page) => page.title)).toEqual(["Accueil", "Journal"]);
    expect(ajoutee.pages.map((page) => page.title)).toEqual(["Accueil", "Journal", "Contact"]);

    const journal = (await getSite(f.actorAlice, fileId)).pages[1]!;
    const descendue = await movePage(f.actorAlice, fileId, journal.id, "down");
    expect(titres(descendue)).toEqual(["Accueil", "Contact", "Journal"]);
    // Le menu suit l'ordre des pages : une seule source de vérité.
    expect((await getSite(f.actorAlice, fileId)).navigation.map((item) => item.label)).toEqual([
      "Accueil",
      "Contact",
      "Journal",
    ]);

    const remontee = await movePage(f.actorAlice, fileId, journal.id, "up");
    expect(titres(remontee)).toEqual(["Accueil", "Journal", "Contact"]);
    // Les identifiants de page, eux, ne changent jamais.
    expect(remontee.map((page) => page.id)).toEqual(
      [...ajoutee.pages.map((page) => page.id)].sort(),
    );
  });

  it("laisse l'ordre inchangé aux extrémités de la liste", async () => {
    const { entry } = await createSite(f.actorAlice, { title: tag("Bords") });
    const pages = (await getSite(f.actorAlice, entry.id)).pages;
    const premiere = pages[0]!;

    expect(titres(await movePage(f.actorAlice, entry.id, premiere.id, "up"))).toEqual(["Accueil"]);
    // Une page inconnue est refusée, pas ignorée en silence.
    await expect(
      movePage(f.actorAlice, entry.id, "00000000-0000-4000-8000-000000000000", "down"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("journalise chaque déplacement", async () => {
    const { entry } = await createSite(f.actorAlice, { title: tag("Audit ordre") });
    await addPage(f.actorAlice, entry.id, { title: "Journal" });
    const page = (await getSite(f.actorAlice, entry.id)).pages[0]!;

    await movePage(f.actorAlice, entry.id, page.id, "down");
    const rows = await auditRows(f.orgId, "sites.page.move");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ metadata: { pageId: page.id, direction: "down" } });
  });

  it("refuse de réordonner sans droit d'écriture", async () => {
    const { entry } = await createSite(f.actorAlice, { title: tag("Protégé") });
    const added = await addPage(f.actorAlice, entry.id, { title: "Journal" });
    await expect(movePage(f.actorBruno, entry.id, added.pageId, "up")).rejects.toThrow(SitesError);
  });

  it("dérive le menu des pages tant qu'il n'est pas personnalisé", async () => {
    const { entry } = await createSite(f.actorAlice, { title: tag("Menu") });
    const fileId = entry.id;
    await addPage(f.actorAlice, fileId, { title: "Journal" });

    const site = await getSite(f.actorAlice, fileId);
    expect(site.navigation).toEqual([
      { pageId: site.pages[0]!.id, label: "Accueil", visible: true },
      { pageId: site.pages[1]!.id, label: "Journal", visible: true },
    ]);
  });

  it("enregistre un menu personnalisé : libellé et visibilité", async () => {
    const { entry } = await createSite(f.actorAlice, { title: tag("Menu perso") });
    const fileId = entry.id;
    await addPage(f.actorAlice, fileId, { title: "Journal" });
    const pages = (await getSite(f.actorAlice, fileId)).pages;

    await saveNavigation(f.actorAlice, fileId, {
      items: [
        { pageId: pages[1]!.id, label: "Actus", visible: true },
        { pageId: pages[0]!.id, label: "Accueil", visible: false },
      ],
    });

    const site = await getSite(f.actorAlice, fileId);
    // L'ordre reste celui des pages ; seul le contenu des entrées est libre.
    expect(site.navigation).toEqual([
      { pageId: pages[0]!.id, label: "Accueil", visible: false },
      { pageId: pages[1]!.id, label: "Actus", visible: true },
    ]);
  });

  it("ajoute au menu une page créée après personnalisation", async () => {
    const { entry } = await createSite(f.actorAlice, { title: tag("Menu tardif") });
    const fileId = entry.id;
    const pages = (await getSite(f.actorAlice, fileId)).pages;
    await saveNavigation(f.actorAlice, fileId, {
      items: [{ pageId: pages[0]!.id, label: "Bienvenue", visible: true }],
    });

    await addPage(f.actorAlice, fileId, { title: "Contact" });
    const site = await getSite(f.actorAlice, fileId);
    expect(site.navigation.map((item) => item.label)).toEqual(["Bienvenue", "Contact"]);
  });

  it("écarte du menu une page supprimée", async () => {
    const { entry } = await createSite(f.actorAlice, { title: tag("Menu orphelin") });
    const fileId = entry.id;
    const added = await addPage(f.actorAlice, fileId, { title: "Journal" });
    const pages = (await getSite(f.actorAlice, fileId)).pages;
    await saveNavigation(f.actorAlice, fileId, {
      items: pages.map((page) => ({ pageId: page.id, label: page.title, visible: true })),
    });

    await deletePage(f.actorAlice, fileId, added.pageId);
    const site = await getSite(f.actorAlice, fileId);
    expect(site.pages).toHaveLength(1);
    expect(site.navigation).toEqual([{ pageId: pages[0]!.id, label: "Accueil", visible: true }]);
  });

  it("refuse un menu invalide avec un message en français", async () => {
    const { entry } = await createSite(f.actorAlice, { title: tag("Menu invalide") });
    const pages = (await getSite(f.actorAlice, entry.id)).pages;

    await expect(
      saveNavigation(f.actorAlice, entry.id, {
        // Entrées volontairement invalides (page inconnue) : la forme typée
        // est contournée comme le ferait un client malveillant.
        items: [
          { pageId: "00000000-0000-4000-8000-000000000000", label: "Fantôme" },
        ] as unknown as NavigationItem[],
      }),
    ).rejects.toMatchObject({
      code: "validation",
      message: expect.stringContaining("page inconnue"),
    });
    await expect(
      saveNavigation(f.actorAlice, entry.id, {
        items: [
          { pageId: pages[0]!.id, label: "A", visible: true },
          { pageId: pages[0]!.id, label: "B", visible: true },
        ],
      }),
    ).rejects.toMatchObject({ code: "validation", message: expect.stringContaining("deux fois") });

    // Rien n'est enregistré : le menu reste dérivé des pages.
    expect((await getSite(f.actorAlice, entry.id)).navigation.map((item) => item.label)).toEqual([
      "Accueil",
    ]);
  });

  it("refuse d'enregistrer le menu sans droit d'écriture", async () => {
    const { entry } = await createSite(f.actorAlice, { title: tag("Menu protégé") });
    const pages = (await getSite(f.actorAlice, entry.id)).pages;
    await expect(
      saveNavigation(f.actorBruno, entry.id, {
        items: [{ pageId: pages[0]!.id, label: "Pirate", visible: true }],
      }),
    ).rejects.toThrow(SitesError);
  });
});

/** Titres des pages, dans l'ordre courant. */
function titres(pages: { title: string }[]): string[] {
  return pages.map((page) => page.title);
}
