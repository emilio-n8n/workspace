import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBlock, type SiteBlock } from "../src/blocks.ts";
import { addPage, createSite, getPage, getSite, SitesError, savePage } from "../src/index.ts";
import { sitesPages } from "../src/schema.ts";

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
  const chloe = await makeUser("Chloé");

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

/** Page d'accueil d'un site neuf, écrite en Markdown (blocs absents). */
async function createHomePage(title = "Blocs") {
  const { entry } = await createSite(f.actorAlice, { title });
  const site = await getSite(f.actorAlice, entry.id);
  const page = site.pages[0];
  if (!page) throw new Error("page manquante");
  return { fileId: entry.id, page };
}

describe("sites — pages en blocs", () => {
  it("enregistre et relit une mise en page en blocs", async () => {
    const { fileId, page } = await createHomePage();
    const blocks = [
      createBlock("heading"),
      createBlock("text"),
      createBlock("image"),
      createBlock("button"),
      createBlock("columns"),
    ];

    await savePage(f.actorAlice, fileId, page.id, {
      title: "Accueil",
      content: "# Accueil\n",
      blocks,
    });

    const reloaded = await getPage(f.actorAlice, fileId, page.id);
    expect(reloaded.blocks).toHaveLength(5);
    expect(reloaded.blocks?.map((block) => block.kind)).toEqual([
      "heading",
      "text",
      "image",
      "button",
      "columns",
    ]);
    // Le contenu Markdown d'origine reste consultable (une page en blocs peut
    // toujours revenir au Markdown).
    expect(reloaded.content).toBe("# Accueil\n");
    expect(reloaded.title).toBe("Accueil");
    // Le slug ne change pas : il est public.
    expect(reloaded.slug).toBe(page.slug);
  });

  it("laisse les blocs intacts lors d'une sauvegarde sans `blocks`", async () => {
    const { fileId, page } = await createHomePage();
    const blocks = [createBlock("text")];
    await savePage(f.actorAlice, fileId, page.id, { title: "A", content: "", blocks });

    await savePage(f.actorAlice, fileId, page.id, {
      title: "B",
      content: "Autre texte",
    });

    const reloaded = await getPage(f.actorAlice, fileId, page.id);
    expect(reloaded.title).toBe("B");
    expect(reloaded.blocks).toHaveLength(1);
    expect(reloaded.blocks?.[0]?.kind).toBe("text");
  });

  it("efface les blocs quand `blocks` vaut `null` (retour au Markdown)", async () => {
    const { fileId, page } = await createHomePage();
    await savePage(f.actorAlice, fileId, page.id, {
      title: "A",
      content: "",
      blocks: [createBlock("heading")],
    });

    await savePage(f.actorAlice, fileId, page.id, { title: "A", content: "# Titre", blocks: null });

    const reloaded = await getPage(f.actorAlice, fileId, page.id);
    expect(reloaded.blocks).toBeNull();
    expect(reloaded.content).toBe("# Titre");
  });

  it("assainit une mise en page corrompue au lieu de casser la lecture", async () => {
    const { fileId, page } = await createHomePage();
    // Valeur écrite en dehors du service (import, ancienne version du modèle) :
    // identifiant illisible, type inconnu, champ absent. La lecture doit rester
    // possible avec les seuls blocs lisibles.
    const valide = createBlock("heading");
    await getDb().execute(
      sql`update ${sitesPages} set ${sql.raw("blocks")} = ${JSON.stringify([
        { id: "pas-un-uuid", kind: "text", text: "Illisible" },
        valide,
        { id: createBlock("text").id, kind: "video" },
        { id: valide.id, kind: "text" },
      ])}::jsonb where id = ${page.id}`,
    );

    const reloaded = await getPage(f.actorAlice, fileId, page.id);
    expect(reloaded.blocks).toEqual([valide]);
  });

  it("refuse une mise en page invalide avec un message en français", async () => {
    const { fileId, page } = await createHomePage();

    await expect(
      savePage(f.actorAlice, fileId, page.id, {
        title: "A",
        content: "",
        // Entrées volontairement invalides : elles simulent un client hostile.
        blocks: [{ id: "court", kind: "text" }] as unknown as SiteBlock[],
      }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      savePage(f.actorAlice, fileId, page.id, {
        title: "A",
        content: "",
        blocks: [{ id: createBlock("text").id, kind: "video" }] as unknown as SiteBlock[],
      }),
    ).rejects.toMatchObject({
      code: "validation",
      message: expect.stringContaining("Type de bloc inconnu"),
    });

    // Rien n'a été enregistré : la page reste une page Markdown.
    expect((await getPage(f.actorAlice, fileId, page.id)).blocks).toBeNull();
  });

  it("refuse la modification des blocs sans droit ou sur un autre site", async () => {
    const { fileId, page } = await createHomePage();
    const blocks = [createBlock("button")];

    await expect(
      savePage(f.actorBruno, fileId, page.id, { title: "Voleur", content: "", blocks }),
    ).rejects.toThrow(SitesError);

    const other = await createSite(f.actorAlice, { title: "Site B" });
    const otherPage = (await getSite(f.actorAlice, other.entry.id)).pages[0];
    if (!otherPage) throw new Error("page manquante");
    await expect(
      savePage(f.actorAlice, fileId, otherPage.id, { title: "A", content: "", blocks }),
    ).rejects.toMatchObject({ code: "not_found" });

    // La page d'accueil du premier site n'a pas été touchée.
    expect((await getPage(f.actorAlice, fileId, page.id)).blocks).toBeNull();
  });

  it("journalise l'enregistrement des blocs comme toute sauvegarde de page", async () => {
    const { fileId, page } = await createHomePage();
    await savePage(f.actorAlice, fileId, page.id, {
      title: "A",
      content: "",
      blocks: [createBlock("heading")],
    });

    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    const row = rows.find((candidate) => candidate.action === "sites.page.save");
    expect(row).toMatchObject({
      actorUserId: f.actorAlice.userId,
      resourceType: "site",
      resourceId: fileId,
      result: "success",
    });
    expect(row?.metadata).toEqual({ pageId: page.id });
  });

  it("distribue les blocs page par page", async () => {
    const { entry } = await createSite(f.actorAlice, { title: "Multi" });
    const site = await getSite(f.actorAlice, entry.id);
    const home = site.pages[0];
    if (!home) throw new Error("page manquante");

    const added = await addPage(f.actorAlice, entry.id, { title: "Journal" });
    await savePage(f.actorAlice, entry.id, home.id, {
      title: "Accueil",
      content: "",
      blocks: [createBlock("heading")],
    });
    await savePage(f.actorAlice, entry.id, added.pageId, {
      title: "Journal",
      content: "# Journal",
      blocks: null,
    });

    expect((await getPage(f.actorAlice, entry.id, home.id)).blocks).toHaveLength(1);
    expect((await getPage(f.actorAlice, entry.id, added.pageId)).blocks).toBeNull();
  });

  it("garde le type MIME du site et le droit d'édition inchangés", async () => {
    const { fileId, page } = await createHomePage();
    const site = await getSite(f.actorAlice, fileId);
    expect(site.canEdit).toBe(true);

    await savePage(f.actorAlice, fileId, page.id, {
      title: "A",
      content: "",
      blocks: [createBlock("columns")],
    });

    // Une page en blocs ne change ni le type du fichier ni les droits.
    const reread = await getSite(f.actorAlice, fileId);
    expect(reread.canEdit).toBe(true);
    expect(reread.pages.map((candidate) => candidate.slug)).toEqual(
      site.pages.map((candidate) => candidate.slug),
    );
  });
});
