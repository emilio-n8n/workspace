import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import { DriveError, shareEntry } from "@workspace/drive";
import type { Actor } from "@workspace/permissions";
import { getStorage } from "@workspace/storage";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPresentation,
  type ElementInput,
  getPresentation,
  getSlideImage,
  listPresentations,
  MAX_SLIDE_IMAGE_BYTES,
  renamePresentation,
  SLIDES_MIME,
  type SlideInput,
  SlidesError,
  savePresentation,
  uploadSlideImage,
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

function element(overrides: Record<string, unknown> = {}) {
  return {
    kind: "text" as const,
    x: 10,
    y: 20,
    w: 40,
    h: 12,
    text: "Bonjour",
    fontSize: 24,
    bold: false,
    align: "left" as const,
    ...overrides,
  };
}

async function expectSlidesError(
  promise: Promise<unknown>,
  code: SlidesError["code"],
): Promise<SlidesError> {
  const failure = await promise.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(SlidesError);
  const slidesError = failure as SlidesError;
  expect(slidesError.code).toBe(code);
  return slidesError;
}

/** Événements d'audit de l'organisation (filtre optionnel par action). */
async function auditEventsFor(orgId: string, action?: string) {
  const where = action
    ? and(eq(auditEvents.orgId, orgId), eq(auditEvents.action, action))
    : eq(auditEvents.orgId, orgId);
  return getDb().select().from(auditEvents).where(where);
}

describe("slides — cycle de vie", () => {
  it("crée une présentation liée avec une diapositive vierge", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Pitch" });
    expect(entry.mimeType).toBe(SLIDES_MIME);

    const detail = await getPresentation(f.actorAlice, entry.id);
    expect(detail.slides).toHaveLength(1);
    expect(detail.slides[0]?.elements).toHaveLength(0);
    expect(detail.canEdit).toBe(true);
    expect(detail.revision).toBe(1);

    expect(await listPresentations(f.actorBruno)).toHaveLength(0);
    expect((await listPresentations(f.actorAlice))[0]?.title).toBe("Pitch");
  });

  it("remplace les diapositives dans l'ordre en conservant valeurs et éléments", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Deck" });
    const saved = await savePresentation(f.actorAlice, entry.id, {
      revision: 1,
      slides: [
        { title: "Intro", elements: [element()] },
        {
          title: "Produit",
          notes: "Parler des prix",
          elements: [
            element({ kind: "shape", x: 5, y: 5, w: 25, h: 25, text: "" }),
            element({ x: 40, y: 60, text: "Chiffres", fontSize: 32, bold: true }),
          ],
        },
      ],
    });

    expect(saved.slides).toHaveLength(2);
    expect(saved.revision).toBe(2);
    expect(saved.slides[0]?.title).toBe("Intro");
    expect(saved.slides[1]?.notes).toBe("Parler des prix");
    expect(saved.slides[1]?.elements).toHaveLength(2);
    expect(saved.slides[1]?.elements[1]?.bold).toBe(true);

    const reloaded = await getPresentation(f.actorAlice, entry.id);
    expect(reloaded.slides.map((slide) => slide.title)).toEqual(["Intro", "Produit"]);
    expect(reloaded.revision).toBe(2);
  });

  it("borne les coordonnées et la taille de police", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Bornes" });
    const saved = await savePresentation(f.actorAlice, entry.id, {
      revision: 1,
      slides: [
        {
          elements: [element({ x: -20, y: 150, w: 500, h: 0, fontSize: 999 })],
        },
      ],
    });
    const element0 = saved.slides[0]?.elements[0];
    expect(element0?.x).toBe(0);
    // h borné à 1, donc y est contraint à 100 - h = 99 (containment).
    expect(element0?.y).toBe(99);
    expect(element0?.w).toBe(100);
    expect(element0?.h).toBe(1);
    expect(element0?.fontSize).toBe(200);
  });

  it("refuse plus de 100 diapositives et les modifications sans droit", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Gros" });
    await expect(
      savePresentation(f.actorAlice, entry.id, {
        revision: 1,
        slides: Array.from({ length: 101 }, () => ({ elements: [] })),
      }),
    ).rejects.toThrow(SlidesError);

    // Bruno n'a qu'un droit de lecture : sauvegarde refusée par le service.
    await shareEntry(f.actorAlice, entry.id, {
      subject: { kind: "user", id: f.actorBruno.userId },
      role: "viewer",
    });
    const brunoDetail = await getPresentation(f.actorBruno, entry.id);
    expect(brunoDetail.canEdit).toBe(false);
    await expectSlidesError(
      savePresentation(f.actorBruno, entry.id, { revision: 1, slides: [{ elements: [] }] }),
      "forbidden",
    );

    // Chloe est hors organisation : refusé en amont par le Drive.
    await expect(getPresentation(f.actorChloe, entry.id)).rejects.toThrow(DriveError);
  });

  it("renomme la présentation (nom du fichier Drive)", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Ancien" });
    const renamed = await renamePresentation(f.actorAlice, entry.id, "Nouveau");
    expect(renamed.name).toBe("Nouveau");
    const detail = await getPresentation(f.actorAlice, entry.id);
    expect(detail.title).toBe("Nouveau");
    expect(detail.revision).toBe(1);
  });
});

describe("slides — sauvegarde incrémentale", () => {
  it("conserve les identifiants des diapositives et des éléments entre deux sauvegardes", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Stable" });

    const first = await savePresentation(f.actorAlice, entry.id, {
      revision: 1,
      slides: [
        { title: "Intro", elements: [element()] },
        { title: "Produit", elements: [element({ kind: "shape", text: "", w: 20, h: 20 })] },
      ],
    });
    expect(first.revision).toBe(2);
    const slideIds = first.slides.map((slide) => slide.id);
    const elementIds = first.slides.map((slide) => slide.elements.map((item) => item.id));
    expect(slideIds).toHaveLength(2);
    expect(slideIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(elementIds.flat().every((id) => typeof id === "string" && id.length > 0)).toBe(true);

    const second = await savePresentation(f.actorAlice, entry.id, {
      revision: first.revision,
      slides: first.slides.map((slide) => ({
        id: slide.id,
        title: slide.title,
        notes: slide.notes,
        elements: slide.elements.map((item) => ({ ...item, text: `${item.text}!` })),
      })),
    });

    expect(second.revision).toBe(3);
    expect(second.slides.map((slide) => slide.id)).toEqual(slideIds);
    expect(second.slides.map((slide) => slide.elements.map((item) => item.id))).toEqual(elementIds);
    expect(second.slides[0]?.elements[0]?.text).toBe("Bonjour!");
  });

  it("supprime les diapositives et les éléments retirés du payload", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Suppression" });
    const first = await savePresentation(f.actorAlice, entry.id, {
      revision: 1,
      slides: [
        { title: "A", elements: [element(), element({ text: "Deux" })] },
        { title: "B", elements: [] },
      ],
    });
    const keptSlide = first.slides[0];
    const keptElement = keptSlide?.elements[0];
    if (!keptSlide || !keptElement) throw new Error("diapositive et élément attendus");

    const second = await savePresentation(f.actorAlice, entry.id, {
      revision: first.revision,
      slides: [{ id: keptSlide.id, title: "A", notes: null, elements: [keptElement] }],
    });

    expect(second.slides).toHaveLength(1);
    expect(second.slides[0]?.id).toBe(keptSlide.id);
    expect(second.slides[0]?.elements.map((item) => item.id)).toEqual([keptElement.id]);
    expect(second.slides[0]?.elements.map((item) => item.text)).toEqual(["Bonjour"]);
  });

  it("ignore les identifiants qui n'appartiennent pas à la présentation", async () => {
    const presentationA = await createPresentation(f.actorAlice, { title: "A" });
    const presentationB = await createPresentation(f.actorAlice, { title: "B" });
    const detailA = await getPresentation(f.actorAlice, presentationA.entry.id);
    const foreignSlideId = detailA.slides[0]?.id ?? randomUUID();
    const unknownSlideId = randomUUID();
    const unknownElementId = randomUUID();

    const savedB = await savePresentation(f.actorAlice, presentationB.entry.id, {
      revision: 1,
      slides: [
        {
          id: foreignSlideId,
          title: "B1",
          elements: [element({ id: unknownElementId, text: "Intrus" })],
        },
        { id: unknownSlideId, title: "B2", elements: [] },
      ],
    });

    expect(savedB.slides).toHaveLength(2);
    expect(savedB.slides[0]?.id).not.toBe(foreignSlideId);
    expect(savedB.slides[1]?.id).not.toBe(unknownSlideId);
    expect(savedB.slides[0]?.elements[0]?.id).not.toBe(unknownElementId);
    expect(savedB.slides[0]?.title).toBe("B1");

    // La présentation A n'a pas été touchée.
    const afterA = await getPresentation(f.actorAlice, presentationA.entry.id);
    expect(afterA.slides).toHaveLength(1);
    expect(afterA.slides[0]?.id).toBe(detailA.slides[0]?.id);
    expect(afterA.slides[0]?.title).toBe("Diapositive 1");
  });
});

describe("slides — contrôle optimiste", () => {
  it("refuse une révision périmée sans perdre les données, puis accepte après relecture", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Conflit" });
    const first = await savePresentation(f.actorAlice, entry.id, {
      revision: 1,
      slides: [{ title: "Version 1", elements: [element()] }],
    });
    expect(first.revision).toBe(2);

    const conflict = await expectSlidesError(
      savePresentation(f.actorAlice, entry.id, {
        revision: 1,
        slides: [{ title: "Version perdue", elements: [] }],
      }),
      "conflict",
    );
    expect(conflict.message).toContain("modifiée ailleurs");

    // Aucune écriture : contenu et révision intacts.
    const intact = await getPresentation(f.actorAlice, entry.id);
    expect(intact.revision).toBe(2);
    expect(intact.slides.map((slide) => slide.title)).toEqual(["Version 1"]);
    expect(intact.slides[0]?.elements).toHaveLength(1);

    // Nouvelle tentative avec la révision fraîche : les identifiants restent stables.
    const retried = await savePresentation(f.actorAlice, entry.id, {
      revision: intact.revision,
      slides: intact.slides.map((slide) => ({
        id: slide.id,
        title: "Version 2",
        notes: slide.notes,
        elements: slide.elements.map((item) => ({ ...item })),
      })),
    });
    expect(retried.revision).toBe(3);
    expect(retried.slides[0]?.title).toBe("Version 2");
    expect(retried.slides[0]?.id).toBe(intact.slides[0]?.id);
  });
});

describe("slides — validation", () => {
  it("assure la containment x + w ≤ 100 et y + h ≤ 100", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Containment" });
    const saved = await savePresentation(f.actorAlice, entry.id, {
      revision: 1,
      slides: [
        {
          elements: [
            element({ x: 90, y: 95, w: 40, h: 30 }),
            element({ x: 100, y: 100, w: 500, h: 500, text: "" }),
          ],
        },
      ],
    });
    const [first, second] = saved.slides[0]?.elements ?? [];
    expect(first?.x).toBe(60);
    expect(first?.y).toBe(70);
    expect((first?.x ?? 0) + (first?.w ?? 0)).toBeLessThanOrEqual(100);
    expect((first?.y ?? 0) + (first?.h ?? 0)).toBeLessThanOrEqual(100);
    expect(second?.x).toBe(0);
    expect(second?.y).toBe(0);
    expect(second?.w).toBe(100);
    expect(second?.h).toBe(100);
  });

  it("rejette les valeurs non finies", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Non fini" });
    for (const patch of [
      { x: Number.NaN },
      { y: Number.POSITIVE_INFINITY },
      { w: Number.NEGATIVE_INFINITY },
      { h: Number.NaN },
      { fontSize: Number.POSITIVE_INFINITY },
    ]) {
      await expectSlidesError(
        savePresentation(f.actorAlice, entry.id, {
          revision: 1,
          slides: [{ elements: [element(patch)] }],
        }),
        "validation",
      );
    }
    expect((await getPresentation(f.actorAlice, entry.id)).revision).toBe(1);
  });

  it("rejette un alignement inconnu", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Alignement" });
    await expectSlidesError(
      savePresentation(f.actorAlice, entry.id, {
        revision: 1,
        slides: [{ elements: [element({ align: "justify" })] }],
      }),
      "validation",
    );
    await expectSlidesError(
      savePresentation(f.actorAlice, entry.id, {
        revision: 1,
        slides: [{ elements: [element({ kind: "video" })] }],
      }),
      "validation",
    );
  });

  it("rejette les formes invalides avec SlidesError plutôt qu'un TypeError", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Formes" });
    const attempts: (() => Promise<unknown>)[] = [
      () =>
        savePresentation(f.actorAlice, entry.id, {
          revision: 1,
          slides: "nope" as unknown as SlideInput[],
        }),
      () =>
        savePresentation(f.actorAlice, entry.id, {
          revision: 1,
          slides: [undefined as unknown as SlideInput],
        }),
      () =>
        savePresentation(f.actorAlice, entry.id, {
          revision: 1,
          slides: [{ elements: null as unknown as ElementInput[] }],
        }),
      () =>
        savePresentation(f.actorAlice, entry.id, {
          revision: 1,
          slides: [{ elements: [null as unknown as ElementInput] }],
        }),
      () =>
        savePresentation(f.actorAlice, entry.id, {
          revision: 0,
          slides: [{ elements: [] }],
        }),
    ];
    for (const attempt of attempts) {
      await expectSlidesError(attempt(), "validation");
    }
  });
});

describe("slides — images", () => {
  it("conserve le mediaKey d'une image et nettoie son objet quand elle est retirée", async () => {
    const { entry, presentation } = await createPresentation(f.actorAlice, { title: "Illustrée" });
    const mediaKey = `slides/${presentation.id}/${randomUUID()}.png`;
    const body = Buffer.from("png-bytes");
    await getStorage().put({ key: mediaKey, body, contentType: "image/png" });

    const first = await savePresentation(f.actorAlice, entry.id, {
      revision: 1,
      slides: [{ title: "Photo", elements: [element({ kind: "image", text: "", mediaKey })] }],
    });
    const savedElement = first.slides[0]?.elements[0];
    expect(savedElement?.kind).toBe("image");
    expect(savedElement?.text).toBe("");
    expect(savedElement?.mediaKey).toBe(mediaKey);

    const reloaded = await getPresentation(f.actorAlice, entry.id);
    expect(reloaded.slides[0]?.elements[0]?.mediaKey).toBe(mediaKey);

    // Retrait de l'image : son objet est supprimé du stockage après commit.
    const second = await savePresentation(f.actorAlice, entry.id, {
      revision: reloaded.revision,
      slides: [
        {
          id: reloaded.slides[0]?.id,
          title: "Photo",
          notes: null,
          elements: [element({ text: "Sans image" })],
        },
      ],
    });
    expect(second.slides[0]?.elements[0]?.kind).toBe("text");
    expect(second.slides[0]?.elements[0]?.mediaKey).toBeNull();
    expect(await getStorage().get(mediaKey)).toBeNull();
  });

  it("rejette les clés média sur les types non image et les images sans clé valide", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Validation média" });

    // Un texte ou une forme ne porte jamais de clé média.
    await expectSlidesError(
      savePresentation(f.actorAlice, entry.id, {
        revision: 1,
        slides: [{ elements: [element({ mediaKey: "slides/x/y.png" })] }],
      }),
      "validation",
    );

    // Une image exige une clé sous le préfixe `slides/`…
    for (const mediaKey of [null, "", "orgs/x/y.png", 42]) {
      await expectSlidesError(
        savePresentation(f.actorAlice, entry.id, {
          revision: 1,
          slides: [{ elements: [element({ kind: "image", text: "", mediaKey })] }],
        }),
        "validation",
      );
    }

    // …et ne peut pas porter de texte.
    await expectSlidesError(
      savePresentation(f.actorAlice, entry.id, {
        revision: 1,
        slides: [
          { elements: [element({ kind: "image", text: "Légende", mediaKey: "slides/x/y.png" })] },
        ],
      }),
      "validation",
    );

    expect((await getPresentation(f.actorAlice, entry.id)).revision).toBe(1);
  });

  it("téléverse une image et la relit avec son type MIME", async () => {
    const { entry, presentation } = await createPresentation(f.actorAlice, { title: "Upload" });
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const { mediaKey } = await uploadSlideImage(f.actorAlice, entry.id, {
      contentType: "image/png",
      body,
    });
    expect(mediaKey.startsWith(`slides/${presentation.id}/`)).toBe(true);
    expect(mediaKey.endsWith(".png")).toBe(true);
    expect((await getStorage().get(mediaKey))?.equals(body)).toBe(true);

    const image = await getSlideImage(f.actorAlice, entry.id, mediaKey);
    expect(image.contentType).toBe("image/png");
    expect(image.body.equals(body)).toBe(true);

    // Type non image, corps vide et dépassement de la limite : refusés.
    await expectSlidesError(
      uploadSlideImage(f.actorAlice, entry.id, { contentType: "application/pdf", body }),
      "validation",
    );
    await expectSlidesError(
      uploadSlideImage(f.actorAlice, entry.id, { contentType: "image/png", body: Buffer.alloc(0) }),
      "validation",
    );
    await expectSlidesError(
      uploadSlideImage(f.actorAlice, entry.id, {
        contentType: "image/png",
        body: Buffer.alloc(MAX_SLIDE_IMAGE_BYTES + 1),
      }),
      "validation",
    );

    // Un lecteur (droit write absent) ne peut pas téléverser.
    await shareEntry(f.actorAlice, entry.id, {
      subject: { kind: "user", id: f.actorBruno.userId },
      role: "viewer",
    });
    await expectSlidesError(
      uploadSlideImage(f.actorBruno, entry.id, { contentType: "image/jpeg", body }),
      "forbidden",
    );
  });

  it("interdit la lecture d'une image d'une autre présentation (anti-IDOR)", async () => {
    const a = await createPresentation(f.actorAlice, { title: "A" });
    const b = await createPresentation(f.actorAlice, { title: "B" });
    const { mediaKey } = await uploadSlideImage(f.actorAlice, a.entry.id, {
      contentType: "image/webp",
      body: Buffer.from("webp-bytes"),
    });

    // Clé d'une autre présentation, préfixe étranger : validation.
    await expectSlidesError(getSlideImage(f.actorAlice, b.entry.id, mediaKey), "validation");
    await expectSlidesError(
      getSlideImage(f.actorAlice, a.entry.id, `slides/${b.presentation.id}/x.webp`),
      "validation",
    );
    await expectSlidesError(
      getSlideImage(f.actorAlice, a.entry.id, `orgs/${f.orgId}/x.webp`),
      "validation",
    );

    // Clé bien préfixée mais objet absent : introuvable.
    await expectSlidesError(
      getSlideImage(f.actorAlice, b.entry.id, `slides/${b.presentation.id}/absent.webp`),
      "not_found",
    );
  });
});

describe("slides — journal d'audit", () => {
  it("journalise la création (slides.presentation.create)", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Audit création" });

    const rows = await auditEventsFor(f.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: f.orgId,
      actorUserId: f.actorAlice.userId,
      action: "slides.presentation.create",
      resourceType: "presentation",
      resourceId: entry.id,
      result: "success",
    });
  });

  it("journalise l'upload d'image avec sa clé média (slides.image.upload)", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Audit upload" });
    const { mediaKey } = await uploadSlideImage(f.actorAlice, entry.id, {
      contentType: "image/png",
      body: Buffer.from("png-bytes"),
    });

    const rows = await auditEventsFor(f.orgId, "slides.image.upload");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: f.orgId,
      actorUserId: f.actorAlice.userId,
      action: "slides.image.upload",
      resourceType: "presentation",
      resourceId: entry.id,
      result: "success",
      metadata: { mediaKey },
    });
  });

  it("journalise le renommage (slides.presentation.rename)", async () => {
    const { entry } = await createPresentation(f.actorAlice, { title: "Avant" });
    await renamePresentation(f.actorAlice, entry.id, "Après");

    const rows = await auditEventsFor(f.orgId, "slides.presentation.rename");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: f.orgId,
      actorUserId: f.actorAlice.userId,
      resourceType: "presentation",
      resourceId: entry.id,
      result: "success",
    });
  });

  it("ne journalise pas les sauvegardes automatiques, même après retrait d'une image", async () => {
    const { entry, presentation } = await createPresentation(f.actorAlice, {
      title: "Autosave",
    });
    const mediaKey = `slides/${presentation.id}/${randomUUID()}.png`;
    await getStorage().put({ key: mediaKey, body: Buffer.from("png"), contentType: "image/png" });

    const first = await savePresentation(f.actorAlice, entry.id, {
      revision: 1,
      slides: [
        { title: "A", elements: [element({ kind: "image", text: "", mediaKey })] },
        { title: "B", elements: [element()] },
      ],
    });
    const [slideA, slideB] = first.slides;
    if (!slideA || !slideB) throw new Error("diapositives attendues");

    // Réordonne et retire l'image : ni la sauvegarde ni le nettoyage de
    // l'objet de stockage ne doivent écrire d'événement d'audit.
    await savePresentation(f.actorAlice, entry.id, {
      revision: first.revision,
      slides: [
        { id: slideB.id, title: slideB.title, notes: null, elements: [] },
        {
          id: slideA.id,
          title: slideA.title,
          notes: null,
          elements: [element({ text: "Sans image" })],
        },
      ],
    });
    expect(await getStorage().get(mediaKey)).toBeNull();

    const rows = await auditEventsFor(f.orgId);
    expect(rows.map((row) => row.action)).toEqual(["slides.presentation.create"]);
  });
});
