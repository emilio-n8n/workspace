import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addComment,
  ClassroomError,
  createAnnouncement,
  createCourse,
  deleteAnnouncement,
  deleteComment,
  getCourse,
  joinByCode,
  listAnnouncements,
  MAX_ANNOUNCEMENT_BODY,
  MAX_COMMENT_BODY,
} from "../src/index.ts";

const { user, organization } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  otherOrgId: string;
  actorAlice: Actor;
  actorBruno: Actor;
  /** Élève inscrit dans une AUTRE organisation (espace personnel). */
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

  const makeUser = async (name: string, org: string) => {
    const id = tag("usr");
    await db.insert(user).values({
      id,
      name,
      email: `${id}@example.org`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return { userId: id, orgId: org };
  };

  const alice = await makeUser("Alice", orgId);
  const bruno = await makeUser("Bruno", orgId);
  const chloe = await makeUser("Chloe", otherOrgId);
  return { orgId, otherOrgId, actorAlice: alice, actorBruno: bruno, actorChloe: chloe };
}

/** Cours d'Alice avec Bruno (même organisation) et Chloé (autre organisation). */
async function courseWithMembers(name: string): Promise<{ id: string; joinCode: string }> {
  const course = await createCourse(f.actorAlice, { name });
  const detail = await getCourse(f.actorAlice, course.id);
  const joinCode = detail.joinCode;
  if (!joinCode) throw new Error("code manquant");
  await joinByCode(f.actorBruno, joinCode);
  await joinByCode(f.actorChloe, joinCode);
  return { id: course.id, joinCode };
}

let f: Fixtures;

beforeEach(async () => {
  f = await createFixtures();
});

afterEach(async () => {
  const db = getDb();
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  await db.delete(user).where(eq(user.id, f.actorAlice.userId));
  await db.delete(user).where(eq(user.id, f.actorBruno.userId));
  await db.delete(user).where(eq(user.id, f.actorChloe.userId));
});

afterAll(async () => {
  await closeDb();
});

describe("classroom — fil d'actualité", () => {
  it("publie comme enseignant, lit le fil et respecte l'ordre de lecture", async () => {
    const { id: courseId } = await courseWithMembers("Histoire");

    const first = await createAnnouncement(f.actorAlice, courseId, { body: "Cours décalé à 10h." });
    await createAnnouncement(f.actorAlice, courseId, { body: "Pensez à vos cahiers." });

    const feed = await listAnnouncements(f.actorAlice, courseId);
    expect(feed).toHaveLength(2);
    // De la publication la plus récente à la plus ancienne.
    expect(feed[0]?.body).toBe("Pensez à vos cahiers.");
    expect(feed[1]?.body).toBe("Cours décalé à 10h.");
    expect(feed[0]?.author.name).toBe("Alice");
    expect(feed[0]?.canDelete).toBe(true);
    expect(feed[0]?.comments).toHaveLength(0);

    // L'ordre inverse pour un même auteur : la publication d'origine reste là.
    expect(feed.map((row) => row.id)).toContain(first.id);
  });

  it("réserve la publication aux enseignants et refuse un texte vide ou démesuré", async () => {
    const { id: courseId } = await courseWithMembers("SVT");

    await expect(createAnnouncement(f.actorBruno, courseId, { body: "Je publie" })).rejects.toThrow(
      ClassroomError,
    );
    await expect(createAnnouncement(f.actorAlice, courseId, { body: "   " })).rejects.toThrow(
      ClassroomError,
    );
    await expect(
      createAnnouncement(f.actorAlice, courseId, { body: "x".repeat(MAX_ANNOUNCEMENT_BODY + 1) }),
    ).rejects.toThrow(ClassroomError);

    expect(await listAnnouncements(f.actorAlice, courseId)).toHaveLength(0);
  });

  it("laisse tout membre commenter, y compris d'une autre organisation", async () => {
    const { id: courseId } = await courseWithMembers("Français");
    const announcement = await createAnnouncement(f.actorAlice, courseId, { body: "Lecture" });
    if (!announcement.id) throw new Error("publication manquante");

    // Bruno (même organisation) et Chloé (autre organisation) commentent.
    const first = await addComment(f.actorBruno, announcement.id, { body: "Compris !" });
    await addComment(f.actorChloe, announcement.id, { body: "Question : quelle page ?" });

    const [post] = await listAnnouncements(f.actorChloe, courseId);
    expect(post?.comments).toHaveLength(2);
    // Les commentaires se lisent du plus ancien au plus récent.
    expect(post?.comments[0]?.body).toBe("Compris !");
    expect(post?.comments[0]?.author.name).toBe("Bruno");
    expect(post?.comments[1]?.body).toBe("Question : quelle page ?");

    // Chloé retrouve son commentaire dans le fil malgré la frontière d'organisation.
    const feed = await listAnnouncements(f.actorChloe, courseId);
    expect(feed[0]?.comments.some((comment) => comment.author.id === f.actorChloe.userId)).toBe(
      true,
    );

    await expect(addComment(f.actorAlice, announcement.id, { body: "" })).rejects.toThrow(
      ClassroomError,
    );
    await expect(
      addComment(f.actorAlice, announcement.id, { body: "x".repeat(MAX_COMMENT_BODY + 1) }),
    ).rejects.toThrow(ClassroomError);
    expect(first.id).toBeTruthy();
  });

  it("laisse chacun supprimer son commentaire, jamais celui d'un autre", async () => {
    const { id: courseId } = await courseWithMembers("Physique");
    const announcement = await createAnnouncement(f.actorAlice, courseId, { body: "TPS" });
    if (!announcement.id) throw new Error("publication manquante");
    const brunoComment = await addComment(f.actorBruno, announcement.id, { body: "Bonjour" });

    // Chloé ne peut pas supprimer le commentaire de Bruno.
    await expect(deleteComment(f.actorChloe, brunoComment.id)).rejects.toThrow(ClassroomError);
    // L'auteur, oui.
    await deleteComment(f.actorBruno, brunoComment.id);
    expect((await listAnnouncements(f.actorAlice, courseId))[0]?.comments).toHaveLength(0);

    // L'enseignant peut supprimer n'importe quel commentaire du cours.
    const chloeComment = await addComment(f.actorChloe, announcement.id, { body: "Bonsoir" });
    await deleteComment(f.actorAlice, chloeComment.id);
    expect((await listAnnouncements(f.actorAlice, courseId))[0]?.comments).toHaveLength(0);
  });

  it("réserve la suppression d'une publication aux enseignants", async () => {
    const { id: courseId } = await courseWithMembers("Maths");
    const announcement = await createAnnouncement(f.actorAlice, courseId, {
      body: "Nouveau devoir",
    });
    if (!announcement.id) throw new Error("publication manquante");
    await addComment(f.actorBruno, announcement.id, { body: "Merci" });

    // Même élève inscrit depuis une autre organisation : refus.
    await expect(deleteAnnouncement(f.actorChloe, announcement.id)).rejects.toThrow(ClassroomError);
    expect(await listAnnouncements(f.actorAlice, courseId)).toHaveLength(1);

    // L'enseignant supprime la publication et ses commentaires (cascade).
    await deleteAnnouncement(f.actorAlice, announcement.id);
    expect(await listAnnouncements(f.actorAlice, courseId)).toHaveLength(0);
  });

  it("refuse le fil à quelqu'un qui n'est pas membre du cours", async () => {
    const { id: courseId } = await courseWithMembers("Chimie");
    const intruder: Actor = { userId: tag("usr"), orgId: tag("org") };
    await expect(listAnnouncements(intruder, courseId)).rejects.toThrow(ClassroomError);
  });
});
