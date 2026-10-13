import { randomUUID } from "node:crypto";
import { schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveMessage,
  ensureMailbox,
  listFolders,
  listMessages,
  unarchiveMessage,
} from "../src/index.ts";
import { mailMessages } from "../src/schema.ts";
import {
  clampIndex,
  formatShortcutKeys,
  resolveShortcut,
  SHORTCUTS,
  type ShortcutEvent,
  stepIndex,
} from "../src/ui/shortcuts.ts";

const { user, organization } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

function key(partial: Partial<ShortcutEvent>): ShortcutEvent {
  return {
    key: "j",
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...partial,
  };
}

/** Cible reconstituée structurellement (les tests tournent hors navigateur). */
function target(tagName: string, role?: string): unknown {
  return {
    tagName,
    getAttribute: (name: string) => (name === "role" ? (role ?? null) : null),
  };
}

describe("raccourcis — résolution des touches", () => {
  it("mappe les gestes attendus d'un client mail", () => {
    expect(resolveShortcut(key({ key: "j" }), null)).toBe("next");
    expect(resolveShortcut(key({ key: "ArrowDown" }), null)).toBe("next");
    expect(resolveShortcut(key({ key: "k" }), null)).toBe("previous");
    expect(resolveShortcut(key({ key: "ArrowUp" }), null)).toBe("previous");
    expect(resolveShortcut(key({ key: "n" }), null)).toBe("compose");
    expect(resolveShortcut(key({ key: "e" }), null)).toBe("archive");
    expect(resolveShortcut(key({ key: "r" }), null)).toBe("reply");
    expect(resolveShortcut(key({ key: "s" }), null)).toBe("star");
    expect(resolveShortcut(key({ key: "o" }), null)).toBe("open");
    expect(resolveShortcut(key({ key: "/" }), null)).toBe("search");
    expect(resolveShortcut(key({ key: "?", shiftKey: true }), null)).toBe("help");
    // Majuscule explicite : ⇧ G va à la fin de la liste, pas en composition.
    expect(resolveShortcut(key({ key: "G", shiftKey: true }), null)).toBe("last");
    expect(resolveShortcut(key({ key: "g" }), null)).toBe("first");
  });

  it("laisse le clavier à l'utilisateur dans les champs de saisie", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(resolveShortcut(key({ key: "n" }), target(tagName))).toBeNull();
    }
    expect(resolveShortcut(key({ key: "n" }), target("DIV", "textbox"))).toBeNull();
    expect(resolveShortcut(key({ key: "n" }), { isContentEditable: true })).toBeNull();
    expect(resolveShortcut(key({ key: "n" }), target("DIV"))).toBe("compose");
  });

  it("garde Échap disponible même pendant la saisie, jamais dans une modale", () => {
    expect(resolveShortcut(key({ key: "Escape" }), target("INPUT"))).toBe("close");
    expect(resolveShortcut(key({ key: "Escape" }), null, { modalOpen: true })).toBeNull();
  });

  it("désactive tout raccourci quand une boîte de dialogue est ouverte", () => {
    expect(resolveShortcut(key({ key: "n" }), null, { modalOpen: true })).toBeNull();
    expect(resolveShortcut(key({ key: "e" }), null, { modalOpen: true })).toBeNull();
  });

  it("laisse les combinaisons système au navigateur", () => {
    expect(resolveShortcut(key({ key: "n", metaKey: true }), null)).toBeNull();
    expect(resolveShortcut(key({ key: "n", ctrlKey: true }), null)).toBeNull();
    expect(resolveShortcut(key({ key: "n", altKey: true }), null)).toBeNull();
  });

  it("n'attribue jamais deux actions à la même touche", () => {
    const seen = new Map<string, string>();
    for (const shortcut of SHORTCUTS) {
      for (const entry of shortcut.keys) {
        const id = `${entry.shiftKey ? "⇧" : ""}${entry.key}`;
        expect(seen.has(id)).toBe(false);
        seen.set(id, shortcut.action);
      }
    }
    expect(seen.size).toBe(SHORTCUTS.reduce((total, shortcut) => total + shortcut.keys.length, 0));
  });

  it("expose des libellés lisibles pour l'aide", () => {
    expect(formatShortcutKeys([{ key: "j" }])).toBe("j");
    expect(formatShortcutKeys([{ key: "j" }, { key: "ArrowDown" }])).toBe("j ou ↓");
    expect(formatShortcutKeys([{ key: "G", shiftKey: true }])).toBe("⇧ G");
  });
});

describe("raccourcis — déplacement dans la liste", () => {
  it("descend et monte sans jamais sortir de la liste", () => {
    expect(stepIndex(-1, 1, 3)).toBe(0);
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(-1, -1, 3)).toBe(2);
  });

  it("ne déplace rien sur une liste vide", () => {
    expect(stepIndex(-1, 1, 0)).toBeNull();
    expect(stepIndex(4, -1, 0)).toBeNull();
  });

  it("recadre une sélection devenue impossible", () => {
    expect(clampIndex(7, 3)).toBe(2);
    expect(clampIndex(-4, 3)).toBe(0);
    expect(clampIndex(1, 0)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Archives : le geste « e » doit avoir un effet réel et réversible
// ---------------------------------------------------------------------------

describe("raccourcis — archivage", () => {
  let orgId = "";
  let actor: Actor;
  let otherActor: Actor;

  beforeEach(async () => {
    const db = getDb();
    const now = new Date();
    orgId = tag("org");
    await db
      .insert(organization)
      .values({ id: orgId, name: tag("Org "), slug: orgId, createdAt: now });
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
    actor = { userId: await makeUser("Alice"), orgId };
    otherActor = { userId: await makeUser("Bruno"), orgId };
  });

  afterEach(async () => {
    const db = getDb();
    await db.delete(organization).where(eq(organization.id, orgId));
    await db.delete(user).where(eq(user.id, actor.userId));
    await db.delete(user).where(eq(user.id, otherActor.userId));
  });

  afterAll(async () => {
    const { closeDb } = await import("@workspace/database");
    await closeDb();
  });

  async function insert(folder: string, subject: string): Promise<string> {
    const box = await ensureMailbox(actor);
    const [created] = await getDb()
      .insert(mailMessages)
      .values({
        orgId,
        mailboxId: box.id,
        folder,
        fromAddress: "ami@example.org",
        toAddresses: [box.address],
        subject,
        body: "Corps",
      })
      .returning({ id: mailMessages.id });
    if (!created) throw new Error("insertion impossible");
    return created.id;
  }

  it("sort un message de la boîte de réception et le rend à sa place", async () => {
    const id = await insert("inbox", "À archiver");

    await archiveMessage(actor, id);
    expect(await listMessages(actor, { folder: "inbox", threaded: false })).toHaveLength(0);
    expect(await listMessages(actor, { folder: "archive", threaded: false })).toHaveLength(1);

    await unarchiveMessage(actor, id);
    const restored = await listMessages(actor, { folder: "inbox", threaded: false });
    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe(id);
    expect(await listMessages(actor, { folder: "archive", threaded: false })).toHaveLength(0);
  });

  it("mémorise le dossier d'origine d'un message envoyé", async () => {
    const id = await insert("sent", "Envoi archivé");
    await archiveMessage(actor, id);
    await unarchiveMessage(actor, id);
    expect(await listMessages(actor, { folder: "sent", threaded: false })).toHaveLength(1);
  });

  it("compte les archives dans les dossiers sans les mêler aux non-lus", async () => {
    await insert("inbox", "Reçu");
    const archived = await insert("inbox", "Archivé");
    await archiveMessage(actor, archived);

    const counts = await listFolders(actor);
    expect(counts.inbox).toEqual({ total: 1, unread: 1 });
    expect(counts.archive).toEqual({ total: 1, unread: 0 });
  });

  it("refuse d'archiver un brouillon ou un message à la corbeille", async () => {
    const { trashMessage } = await import("../src/index.ts");
    const draft = await insert("drafts", "Brouillon");
    const trashed = await insert("inbox", "Jeté");
    await trashMessage(actor, trashed);

    await expect(archiveMessage(actor, draft)).rejects.toMatchObject({ code: "validation" });
    await expect(archiveMessage(actor, trashed)).rejects.toMatchObject({ code: "validation" });
    expect(await listMessages(actor, { folder: "archive", threaded: false })).toHaveLength(0);
  });

  it("ne traverse jamais les boîtes", async () => {
    const id = await insert("inbox", "Privé");
    await expect(archiveMessage(otherActor, id)).rejects.toMatchObject({ code: "not_found" });
    await expect(unarchiveMessage(otherActor, id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("est idempotent : archiver deux fois ne compte qu'une fois", async () => {
    const id = await insert("inbox", "Deux fois");
    await archiveMessage(actor, id);
    await archiveMessage(actor, id);
    await unarchiveMessage(actor, id);
    await unarchiveMessage(actor, id);
    expect(await listMessages(actor, { folder: "inbox", threaded: false })).toHaveLength(1);
    expect(await listMessages(actor, { folder: "archive", threaded: false })).toHaveLength(0);
  });
});
