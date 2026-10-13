import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createForm,
  exportResponsesCsv,
  FORMS_MIME,
  FormsError,
  getFormByFileId,
  getPublicForm,
  listForms,
  listResponses,
  saveForm,
  submitResponse,
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

async function createTestForm() {
  const { entry, form } = await createForm(f.actorAlice, { title: "Enquête" });
  await saveForm(f.actorAlice, entry.id, {
    status: "open",
    description: "Votre avis compte",
    questions: [
      { kind: "short_text", label: "Votre nom", required: true },
      { kind: "choice", label: "Couleur préférée", options: ["Rouge", "Bleu"] },
      { kind: "scale", label: "Satisfaction", required: true },
    ],
  });
  const detail = await getFormByFileId(f.actorAlice, entry.id);
  return { entry, form, detail };
}

describe("forms — cycle de vie", () => {
  it("crée un fichier Drive lié et ne le partage pas implicitement", async () => {
    const { entry, form } = await createForm(f.actorAlice, { title: "Sondage" });
    expect(entry.mimeType).toBe(FORMS_MIME);
    expect(form.slug).toMatch(/^[0-9a-f]{9}$/);

    const aliceForms = await listForms(f.actorAlice);
    expect(aliceForms.some((item) => item.fileId === entry.id)).toBe(true);
    expect(await listForms(f.actorBruno)).toHaveLength(0);
    expect(await listForms(f.actorChloe)).toHaveLength(0);
  });

  it("génère des slugs uniques", async () => {
    const first = await createForm(f.actorAlice, { title: "A" });
    const second = await createForm(f.actorAlice, { title: "B" });
    expect(first.form.slug).not.toBe(second.form.slug);
  });

  it("crée les formulaires en brouillon (invisibles publiquement)", async () => {
    const { form } = await createForm(f.actorAlice, { title: "Brouillon" });
    expect(form.status).toBe("draft");

    const detail = await getFormByFileId(f.actorAlice, form.fileId);
    expect(detail.status).toBe("draft");
    await expect(getPublicForm(form.slug)).rejects.toThrow(FormsError);
  });

  it("enregistre les questions dans l'ordre et refuse les intitulés vides", async () => {
    const { entry, detail } = await createTestForm();
    expect(detail.questions.map((question) => question.label)).toEqual([
      "Votre nom",
      "Couleur préférée",
      "Satisfaction",
    ]);
    expect(detail.canEdit).toBe(true);

    await expect(
      saveForm(f.actorAlice, entry.id, {
        questions: [{ kind: "short_text", label: "" }],
      }),
    ).rejects.toThrow(FormsError);
  });

  it("refuse les options en double (après trim)", async () => {
    const { entry } = await createForm(f.actorAlice, { title: "Doublons" });
    await expect(
      saveForm(f.actorAlice, entry.id, {
        questions: [{ kind: "choice", label: "Couleur", options: ["Rouge", " Rouge ", "Bleu"] }],
      }),
    ).rejects.toThrow(/options en double/);
  });

  it("conserve les réponses quand les questions sont ré-enregistrées avec leurs ids", async () => {
    const { entry, form, detail } = await createTestForm();
    const [name, choice, scale] = detail.questions;
    if (!name || !choice || !scale) throw new Error("questions manquantes");

    await submitResponse(form.slug, {
      [name.id]: "Alice",
      [choice.id]: "Bleu",
      [scale.id]: "4",
    });

    // Ré-enregistrement avec les mêmes ids : l'intitulé change, l'identité non.
    const updated = await saveForm(f.actorAlice, entry.id, {
      questions: [
        { id: name.id, kind: "short_text", label: "Votre prénom", required: true },
        { id: choice.id, kind: "choice", label: "Couleur préférée", options: ["Rouge", "Bleu"] },
        { id: scale.id, kind: "scale", label: "Satisfaction générale", required: true },
        { kind: "long_text", label: "Commentaire" },
      ],
    });
    expect(updated.questions).toHaveLength(4);
    expect(updated.questions.slice(0, 3).map((question) => question.id)).toEqual([
      name.id,
      choice.id,
      scale.id,
    ]);

    const { responses } = await listResponses(f.actorAlice, entry.id);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.answers[name.id]).toBe("Alice");
    expect(responses[0]?.answers[choice.id]).toBe("Bleu");
    expect(responses[0]?.answers[scale.id]).toBe("4");

    // La suppression d'une question ne touche que celle-ci.
    await saveForm(f.actorAlice, entry.id, {
      questions: [
        { id: name.id, kind: "short_text", label: "Votre prénom", required: true },
        { id: choice.id, kind: "choice", label: "Couleur préférée", options: ["Rouge", "Bleu"] },
      ],
    });
    const trimmed = await getFormByFileId(f.actorAlice, entry.id);
    expect(trimmed.questions.map((question) => question.id)).toEqual([name.id, choice.id]);
    const afterTrim = await listResponses(f.actorAlice, entry.id);
    expect(afterTrim.responses[0]?.answers[name.id]).toBe("Alice");
  });

  it("refuse la modification par un membre sans droit", async () => {
    const { entry } = await createTestForm();
    await expect(saveForm(f.actorBruno, entry.id, { title: "Détournement" })).rejects.toThrow(
      FormsError,
    );
  });
});

describe("forms — collecte publique", () => {
  it("cache les brouillons et expose les formulaires ouverts", async () => {
    const { entry, form } = await createTestForm();
    await saveForm(f.actorAlice, entry.id, { status: "draft" });
    await expect(getPublicForm(form.slug)).rejects.toThrow(FormsError);

    await saveForm(f.actorAlice, entry.id, { status: "open" });
    const publicForm = await getPublicForm(form.slug);
    expect(publicForm.title).toBe("Enquête");
    expect(publicForm.questions).toHaveLength(3);
  });

  it("valide les réponses obligatoires, les choix et l'échelle", async () => {
    const { form, detail } = await createTestForm();
    const [name, choice, scale] = detail.questions;
    if (!name || !choice || !scale) throw new Error("questions manquantes");

    await expect(submitResponse(form.slug, {})).rejects.toThrow(FormsError);
    await expect(
      submitResponse(form.slug, {
        [name.id]: "Alice",
        [choice.id]: "Vert",
        [scale.id]: "3",
      }),
    ).rejects.toThrow(FormsError);
    await expect(
      submitResponse(form.slug, {
        [name.id]: "Alice",
        [choice.id]: "Bleu",
        [scale.id]: "9",
      }),
    ).rejects.toThrow(FormsError);

    const ok = await submitResponse(form.slug, {
      [name.id]: "Alice",
      [choice.id]: "Bleu",
      [scale.id]: "4",
    });
    expect(ok.ok).toBe(true);

    const responses = await listResponses(f.actorAlice, detail.fileId);
    expect(responses.responses).toHaveLength(1);
    expect(responses.responses[0]?.answers[name.id]).toBe("Alice");

    await expect(listResponses(f.actorBruno, detail.fileId)).rejects.toThrow(FormsError);
    await expect(listResponses(f.actorChloe, detail.fileId)).rejects.toThrow(FormsError);
  });

  it("n'accepte pour l'échelle qu'un chiffre de 1 à 5 (sans coercition)", async () => {
    const { form, detail } = await createTestForm();
    const [name, choice, scale] = detail.questions;
    if (!name || !choice || !scale) throw new Error("questions manquantes");

    for (const value of ["0x3", "1e0", " 3 ", "3.0", "03", "3 ", "⅗"]) {
      await expect(
        submitResponse(form.slug, {
          [name.id]: "Alice",
          [choice.id]: "Bleu",
          [scale.id]: value,
        }),
      ).rejects.toThrow(FormsError);
    }

    const ok = await submitResponse(form.slug, {
      [name.id]: "Alice",
      [choice.id]: "Bleu",
      [scale.id]: "3",
    });
    expect(ok.ok).toBe(true);

    const { responses } = await listResponses(f.actorAlice, detail.fileId);
    expect(responses[0]?.answers[scale.id]).toBe("3");
  });

  it("n'accepte qu'une date du calendrier et une réponse « Oui » ou « Non »", async () => {
    const { entry, form } = await createForm(f.actorAlice, { title: "Rendez-vous" });
    const detail = await saveForm(f.actorAlice, entry.id, {
      status: "open",
      questions: [
        { kind: "date", label: "Date de naissance", required: true },
        { kind: "yes_no", label: "Abonné à la lettre", required: true },
      ],
    });
    const [naissance, abonnement] = detail.questions;
    if (!naissance || !abonnement) throw new Error("questions manquantes");

    // Les deux questions sont obligatoires.
    await expect(submitResponse(form.slug, {})).rejects.toThrow(/obligatoire/);

    // 2026 n'est pas bissextile : le 29 février est refusé explicitement.
    await expect(
      submitResponse(form.slug, {
        [naissance.id]: "2026-02-29",
        [abonnement.id]: "Oui",
      }),
    ).rejects.toThrow(/date valide au format JJ\/MM\/AAAA/);

    await expect(
      submitResponse(form.slug, {
        [naissance.id]: "29/02/2026",
        [abonnement.id]: "Oui",
      }),
    ).rejects.toThrow(/date valide/);

    await expect(
      submitResponse(form.slug, {
        [naissance.id]: "2026-02-28",
        [abonnement.id]: "Peut-être",
      }),
    ).rejects.toThrow(/« Oui » ou « Non »/);

    await submitResponse(form.slug, {
      [naissance.id]: "2026-02-28",
      [abonnement.id]: "Non",
    });

    const { responses } = await listResponses(f.actorAlice, entry.id);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.answers[naissance.id]).toBe("2026-02-28");
    expect(responses[0]?.answers[abonnement.id]).toBe("Non");
  });

  it("ignore les options laissées sur un type sans choix", async () => {
    const { entry } = await createForm(f.actorAlice, { title: "Options oubliées" });
    const detail = await saveForm(f.actorAlice, entry.id, {
      status: "open",
      questions: [{ kind: "date", label: "Échéance", options: ["Rouge", "Bleu"] }],
    });
    expect(detail.questions[0]?.options).toEqual([]);
  });

  it("déduplique les cases à cocher en conservant l'ordre de première occurrence", async () => {
    const { entry, form } = await createForm(f.actorAlice, { title: "Sports" });
    const detail = await saveForm(f.actorAlice, entry.id, {
      status: "open",
      questions: [
        {
          kind: "checkbox",
          label: "Sports pratiqués",
          required: true,
          options: ["Foot", "Tennis", "Rugby"],
        },
      ],
    });
    const [sports] = detail.questions;
    if (!sports) throw new Error("question manquante");

    await expect(submitResponse(form.slug, { [sports.id]: [] })).rejects.toThrow(FormsError);

    await submitResponse(form.slug, {
      [sports.id]: ["Tennis", "Foot", "Tennis", " Foot ", "Rugby"],
    });
    const { responses } = await listResponses(f.actorAlice, entry.id);
    expect(responses[0]?.answers[sports.id]).toEqual(["Tennis", "Foot", "Rugby"]);
  });

  it("pagine les réponses (limit + before)", async () => {
    const { form, detail } = await createTestForm();
    const [name, choice, scale] = detail.questions;
    if (!name || !choice || !scale) throw new Error("questions manquantes");

    for (const value of ["1", "2", "3"]) {
      await submitResponse(form.slug, {
        [name.id]: "Alice",
        [choice.id]: "Bleu",
        [scale.id]: value,
      });
    }

    const first = await listResponses(f.actorAlice, detail.fileId, { limit: 2 });
    expect(first.responses).toHaveLength(2);
    const last = first.responses[1];
    if (!last) throw new Error("pagination impossible");

    const second = await listResponses(f.actorAlice, detail.fileId, {
      limit: 2,
      before: last.submittedAt,
    });
    expect(second.responses).toHaveLength(1);
    const ids = new Set([...first.responses, ...second.responses].map((response) => response.id));
    expect(ids.size).toBe(3);
  });

  it("refuse les réponses quand le formulaire est fermé", async () => {
    const { entry, form, detail } = await createTestForm();
    await saveForm(f.actorAlice, entry.id, { status: "closed" });
    const [name, , scale] = detail.questions;
    if (!name || !scale) throw new Error("questions manquantes");
    await expect(
      submitResponse(form.slug, { [name.id]: "Alice", [scale.id]: "3" }),
    ).rejects.toThrow(FormsError);
    expect((await getPublicForm(form.slug)).status).toBe("closed");
  });

  it("exporte les réponses en CSV (en-têtes, échappement)", async () => {
    const { form, detail } = await createTestForm();
    const [name, choice, scale] = detail.questions;
    if (!name || !choice || !scale) throw new Error("questions manquantes");
    await submitResponse(form.slug, {
      [name.id]: 'Alice, "la" grande',
      [choice.id]: "Bleu",
      [scale.id]: "5",
    });

    const csv = await exportResponsesCsv(f.actorAlice, detail.fileId);
    expect(csv.contentType).toBe("text/csv; charset=utf-8");
    expect(csv.body).toContain("Votre nom");
    expect(csv.body).toContain('"Alice, ""la"" grande"');
    expect(csv.body).toContain("Bleu");
  });

  it("neutralise les formules dans le CSV (réponses et intitulés)", async () => {
    const { form, detail } = await createTestForm();
    const [name, choice, scale] = detail.questions;
    if (!name || !choice || !scale) throw new Error("questions manquantes");

    await submitResponse(form.slug, {
      [name.id]: '=HYPERLINK("http://example.org","clic")',
      [choice.id]: "Bleu",
      [scale.id]: "5",
    });
    // Intitulé piégé : re-sauvegardé avec le même id, les réponses survivent.
    await saveForm(f.actorAlice, detail.fileId, {
      questions: [
        { id: name.id, kind: "short_text", label: "=Total", required: true },
        { id: choice.id, kind: "choice", label: "Couleur préférée", options: ["Rouge", "Bleu"] },
        { id: scale.id, kind: "scale", label: "Satisfaction", required: true },
      ],
    });

    const csv = await exportResponsesCsv(f.actorAlice, detail.fileId);
    expect(csv.body).toContain("'=Total");
    expect(csv.body).toContain(`"'=HYPERLINK(""http://example.org"",""clic"")"`);
  });
});

describe("forms — audit", () => {
  it("journalise la création et la sauvegarde du formulaire", async () => {
    const { entry } = await createForm(f.actorAlice, { title: "Audit" });
    await saveForm(f.actorAlice, entry.id, {
      status: "open",
      questions: [{ kind: "short_text", label: "Question" }],
    });

    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));

    const created = rows.find((row) => row.action === "forms.form.create");
    expect(created).toMatchObject({
      orgId: f.orgId,
      actorUserId: f.actorAlice.userId,
      resourceType: "form",
      resourceId: entry.id,
      result: "success",
    });

    const saved = rows.find((row) => row.action === "forms.form.save");
    expect(saved).toMatchObject({
      actorUserId: f.actorAlice.userId,
      resourceType: "form",
      resourceId: entry.id,
      result: "success",
    });
    expect(saved?.metadata).toEqual({ status: "open" });
  });

  it("n'ajoute aucune ligne d'audit pour une réponse publique", async () => {
    const { form, detail } = await createTestForm();
    const [name, choice, scale] = detail.questions;
    if (!name || !choice || !scale) throw new Error("questions manquantes");

    const before = await countAuditRows(f.orgId);
    await submitResponse(form.slug, {
      [name.id]: "Alice",
      [choice.id]: "Bleu",
      [scale.id]: "4",
    });
    expect(await countAuditRows(f.orgId)).toBe(before);
  });
});
