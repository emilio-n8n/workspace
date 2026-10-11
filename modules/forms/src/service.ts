import { randomBytes } from "node:crypto";
import { getDb, withTransaction } from "@workspace/database";
import {
  createLinkedFile,
  type DriveEntry,
  DriveError,
  rename as driveRename,
  effectiveRole,
  getEntry,
  touchEntry,
} from "@workspace/drive";
import { type Actor, roleSatisfies } from "@workspace/permissions";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  type FormQuestionRow,
  type FormRow,
  formQuestions,
  formResponses,
  forms,
} from "./schema.ts";

/** Type MIME du pointeur Drive d'un formulaire Workspace. */
export const FORMS_MIME = "application/vnd.workspace.forms+json";

export const FORM_KINDS = ["short_text", "long_text", "choice", "checkbox", "scale"] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export const FORM_STATUSES = ["draft", "open", "closed"] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

const MAX_RESPONSES = 10_000;

export type FormsErrorCode = "not_found" | "forbidden" | "validation" | "conflict";

export class FormsError extends Error {
  readonly code: FormsErrorCode;
  constructor(code: FormsErrorCode, message: string) {
    super(message);
    this.name = "FormsError";
    this.code = code;
  }
}

export type QuestionView = {
  id: string;
  kind: FormKind;
  label: string;
  required: boolean;
  options: string[];
};

export type QuestionInput = {
  /** Identifiant serveur : présent quand la question existe déjà (édition). */
  id?: string;
  kind: FormKind;
  label: string;
  required?: boolean;
  options?: string[];
};

export type FormSummary = {
  id: string;
  fileId: string;
  title: string;
  slug: string;
  status: FormStatus;
  responseCount: number;
  updatedAt: string;
};

export type FormDetail = {
  id: string;
  fileId: string;
  title: string;
  description: string | null;
  slug: string;
  status: FormStatus;
  canEdit: boolean;
  questions: QuestionView[];
};

const db = () => getDb();

function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 255) {
    throw new FormsError("validation", "Le titre doit contenir entre 1 et 255 caractères.");
  }
  return trimmed;
}

function assertStatus(status: string): FormStatus {
  if (!FORM_STATUSES.includes(status as FormStatus)) {
    throw new FormsError("validation", "Statut de formulaire invalide.");
  }
  return status as FormStatus;
}

function assertQuestions(input: QuestionInput[]): QuestionInput[] {
  if (input.length > 100) {
    throw new FormsError("validation", "100 questions au maximum.");
  }
  return input.map((question) => {
    if (!FORM_KINDS.includes(question.kind)) {
      throw new FormsError("validation", "Type de question inconnu.");
    }
    const label = question.label.trim();
    if (label.length < 1 || label.length > 500) {
      throw new FormsError("validation", "Chaque question doit avoir un intitulé (500 max).");
    }
    const needsOptions = question.kind === "choice" || question.kind === "checkbox";
    const options = (question.options ?? [])
      .map((option) => option.trim())
      .filter((option) => option.length > 0);
    if (needsOptions && options.length < 2) {
      throw new FormsError("validation", `« ${label} » doit proposer au moins 2 options.`);
    }
    if (options.length > 50) {
      throw new FormsError("validation", `« ${label} » : 50 options au maximum.`);
    }
    if (new Set(options).size !== options.length) {
      throw new FormsError("validation", `« ${label} » : options en double.`);
    }
    return {
      ...(question.id !== undefined ? { id: question.id } : {}),
      kind: question.kind,
      label,
      required: question.required ?? false,
      options,
    };
  });
}

async function requireForm(
  actor: Actor,
  fileId: string,
): Promise<{ entry: DriveEntry; form: FormRow }> {
  let entry: DriveEntry;
  try {
    entry = await getEntry(actor, fileId);
  } catch (error) {
    // L'API du module Drive lève DriveError : on la retraduit en FormsError
    // pour que les appelants n'aient qu'un seul type d'erreur à gérer.
    if (error instanceof DriveError && error.code === "forbidden") {
      throw new FormsError("forbidden", "Permission insuffisante pour accéder à ce formulaire.");
    }
    if (error instanceof DriveError) {
      throw new FormsError("not_found", "Formulaire introuvable.");
    }
    throw error;
  }
  if (entry.mimeType !== FORMS_MIME) {
    throw new FormsError("not_found", "Formulaire introuvable.");
  }
  const [form] = await db().select().from(forms).where(eq(forms.fileId, fileId)).limit(1);
  if (!form || form.orgId !== actor.orgId) {
    throw new FormsError("not_found", "Formulaire introuvable.");
  }
  return { entry, form };
}

async function requireFormEditor(actor: Actor, fileId: string): Promise<FormRow> {
  const { form } = await requireForm(actor, fileId);
  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "write")) {
    throw new FormsError("forbidden", "Permission insuffisante pour modifier ce formulaire.");
  }
  return form;
}

function toQuestions(rows: FormQuestionRow[]): QuestionView[] {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as FormKind,
    label: row.label,
    required: row.required,
    options: row.options,
  }));
}

async function loadQuestions(formId: string): Promise<QuestionView[]> {
  const rows = await db()
    .select()
    .from(formQuestions)
    .where(eq(formQuestions.formId, formId))
    .orderBy(asc(formQuestions.position));
  return toQuestions(rows);
}

/** Violation d'unicité PostgreSQL sur l'index de slug (`forms_slug_uidx`). */
function isSlugConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === "23505" && String(constraint ?? "").includes("slug");
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

export async function createForm(
  actor: Actor,
  input: { parentFolderId?: string | null; title: string },
): Promise<{ entry: DriveEntry; form: FormRow }> {
  const title = assertTitle(input.title);

  const entry = await createLinkedFile(actor, {
    parentId: input.parentFolderId ?? null,
    name: title,
    mimeType: FORMS_MIME,
  });

  // Le slug est régénéré en cas de collision (index unique) plutôt que
  // pré-vérifié, ce qui évite la fenêtre de course entre la vérification
  // et l'insertion.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = randomBytes(5).toString("hex").slice(0, 9);
    try {
      const [form] = await db()
        .insert(forms)
        .values({
          orgId: actor.orgId,
          fileId: entry.id,
          ownerId: actor.userId,
          title,
          slug,
          status: "draft",
        })
        .returning();
      if (!form) throw new FormsError("conflict", "Création du formulaire impossible.");
      return { entry, form };
    } catch (error) {
      if (!isSlugConflict(error)) throw error;
    }
  }
  throw new FormsError("conflict", "Génération du lien impossible, réessayez.");
}

export async function getFormByFileId(actor: Actor, fileId: string): Promise<FormDetail> {
  const { form } = await requireForm(actor, fileId);
  const role = await effectiveRole(actor, fileId);
  const questions = await loadQuestions(form.id);
  return {
    id: form.id,
    fileId: form.fileId,
    title: form.title,
    description: form.description,
    slug: form.slug,
    status: form.status as FormStatus,
    canEdit: roleSatisfies(role, "write"),
    questions,
  };
}

/** Sauvegarde du formulaire (titre, description, statut, questions). */
export async function saveForm(
  actor: Actor,
  fileId: string,
  input: {
    title?: string;
    description?: string | null;
    status?: string;
    questions?: QuestionInput[];
  },
): Promise<FormDetail> {
  const form = await requireFormEditor(actor, fileId);

  const title = input.title !== undefined ? assertTitle(input.title) : undefined;
  const status = input.status !== undefined ? assertStatus(input.status) : undefined;
  const description =
    input.description !== undefined ? input.description?.trim() || null : undefined;
  const questions = input.questions !== undefined ? assertQuestions(input.questions) : undefined;

  await withTransaction(async (tx) => {
    const formChanges = {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(status !== undefined ? { status } : {}),
    };
    if (Object.keys(formChanges).length > 0) {
      await tx.update(forms).set(formChanges).where(eq(forms.id, form.id));
    }

    if (questions !== undefined) {
      // Upsert par id : les questions réutilisées conservent leur identifiant,
      // donc les réponses déjà collectées (JSONB indexé par id) restent
      // rattachées. Seules les questions absentes de la sauvegarde sont
      // supprimées — un id inconnu de ce formulaire est traité comme une
      // nouvelle question.
      const existing = await tx
        .select({ id: formQuestions.id })
        .from(formQuestions)
        .where(eq(formQuestions.formId, form.id));
      const existingIds = new Set(existing.map((row) => row.id));
      const keptIds = new Set<string>();

      for (const [index, question] of questions.entries()) {
        const values = {
          position: index,
          kind: question.kind,
          label: question.label,
          required: question.required ?? false,
          options: question.options ?? [],
        };
        if (question.id !== undefined && existingIds.has(question.id)) {
          keptIds.add(question.id);
          await tx
            .update(formQuestions)
            .set(values)
            .where(and(eq(formQuestions.id, question.id), eq(formQuestions.formId, form.id)));
        } else {
          await tx.insert(formQuestions).values({ formId: form.id, ...values });
        }
      }

      const removed = [...existingIds].filter((id) => !keptIds.has(id));
      if (removed.length > 0) {
        await tx
          .delete(formQuestions)
          .where(and(eq(formQuestions.formId, form.id), inArray(formQuestions.id, removed)));
      }
    }
  });

  if (title !== undefined && title !== form.title) {
    await driveRename(actor, fileId, title).catch(() => undefined);
  }
  await touchEntry(actor, fileId).catch(() => undefined);

  return getFormByFileId(actor, fileId);
}

/** Formulaires visibles (fichiers Drive liés + compteur de réponses). */
export async function listForms(actor: Actor): Promise<FormSummary[]> {
  const rows = await db()
    .select()
    .from(forms)
    .where(eq(forms.orgId, actor.orgId))
    .orderBy(desc(forms.updatedAt))
    .limit(200);

  const summaries: FormSummary[] = [];
  for (const row of rows) {
    const role = await effectiveRole(actor, row.fileId);
    if (!role) continue;
    const [count] = await db()
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(formResponses)
      .where(eq(formResponses.formId, row.id));
    summaries.push({
      id: row.id,
      fileId: row.fileId,
      title: row.title,
      slug: row.slug,
      status: row.status as FormStatus,
      responseCount: count?.value ?? 0,
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  return summaries;
}

// ---------------------------------------------------------------------------
// Collecte publique (autorisée par le statut `open`)
// ---------------------------------------------------------------------------

export type PublicForm = {
  title: string;
  description: string | null;
  status: FormStatus;
  questions: QuestionView[];
};

export async function getPublicForm(slug: string): Promise<PublicForm> {
  const [form] = await db().select().from(forms).where(eq(forms.slug, slug)).limit(1);
  if (!form || form.status === "draft") {
    throw new FormsError("not_found", "Formulaire introuvable.");
  }
  return {
    title: form.title,
    description: form.description,
    status: form.status as FormStatus,
    questions: await loadQuestions(form.id),
  };
}

function validateAnswers(
  questions: QuestionView[],
  answers: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const question of questions) {
    const raw = answers[question.id];
    if (question.kind === "checkbox") {
      const rawValues = Array.isArray(raw)
        ? raw.map((value) => String(value).trim())
        : typeof raw === "string"
          ? [raw.trim()]
          : [];
      // Déduplication en conservant l'ordre de première occurrence.
      const values: string[] = [];
      for (const value of rawValues) {
        if (value.length === 0 || values.includes(value)) continue;
        values.push(value);
      }
      for (const value of values) {
        if (!question.options.includes(value)) {
          throw new FormsError("validation", `Réponse invalide pour « ${question.label} ».`);
        }
      }
      if (question.required && values.length === 0) {
        throw new FormsError("validation", `« ${question.label} » est obligatoire.`);
      }
      if (values.length > 0) result[question.id] = values;
      continue;
    }

    const rawValue = typeof raw === "string" ? raw : "";
    if (question.kind === "scale") {
      // Échelle stricte : un seul chiffre de 1 à 5, sans décimale, exposant,
      // espace ni zéro superflu (« 0x3 », « 1e0 », « 3.0 », « 3 » entouré
      // d'espaces sont refusés).
      if (rawValue.length === 0) {
        if (question.required) {
          throw new FormsError("validation", `« ${question.label} » est obligatoire.`);
        }
        continue;
      }
      if (!/^[1-5]$/.test(rawValue)) {
        throw new FormsError("validation", `Réponse invalide pour « ${question.label} ».`);
      }
      result[question.id] = rawValue;
      continue;
    }

    const value = rawValue.trim();
    if (question.required && value.length === 0) {
      throw new FormsError("validation", `« ${question.label} » est obligatoire.`);
    }
    if (value.length === 0) continue;
    if (value.length > 5000) {
      throw new FormsError("validation", `Réponse trop longue pour « ${question.label} ».`);
    }
    if (question.kind === "choice" && !question.options.includes(value)) {
      throw new FormsError("validation", `Réponse invalide pour « ${question.label} ».`);
    }
    result[question.id] = value;
  }
  return result;
}

export async function submitResponse(
  slug: string,
  answers: Record<string, string | string[]>,
): Promise<{ ok: true }> {
  const [form] = await db().select().from(forms).where(eq(forms.slug, slug)).limit(1);
  if (!form || form.status === "draft") {
    throw new FormsError("not_found", "Formulaire introuvable.");
  }
  if (form.status !== "open") {
    throw new FormsError("forbidden", "Ce formulaire est fermé.");
  }

  const questions = await loadQuestions(form.id);
  if (questions.length === 0) {
    throw new FormsError("validation", "Ce formulaire n'a pas encore de question.");
  }

  const clean = validateAnswers(questions, answers);

  // Insertion conditionnelle en une seule requête : statut ouvert et limite de
  // réponses sont vérifiés atomiquement, sans fenêtre entre le comptage et
  // l'insertion (TOCTOU). Le statut réel est relu en cas d'échec pour produire
  // l'erreur adaptée.
  const inserted = await db().execute(sql`
    INSERT INTO form_responses (form_id, answers)
    SELECT f.id, ${JSON.stringify(clean)}::jsonb
    FROM forms f
    WHERE f.id = ${form.id}::uuid
      AND f.status = 'open'
      AND (SELECT count(*) FROM form_responses r WHERE r.form_id = f.id) < ${MAX_RESPONSES}::int
    RETURNING id
  `);
  if (inserted.rows.length === 0) {
    const [current] = await db()
      .select({ status: forms.status })
      .from(forms)
      .where(eq(forms.id, form.id))
      .limit(1);
    if (current?.status !== "open") {
      throw new FormsError("forbidden", "Ce formulaire est fermé.");
    }
    throw new FormsError("validation", "Limite de réponses atteinte pour ce formulaire.");
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Réponses (réservées aux éditeurs)
// ---------------------------------------------------------------------------

export type ResponseView = {
  id: string;
  submittedAt: string;
  answers: Record<string, string | string[]>;
};

export type ListResponsesOptions = {
  /** Ne renvoyer que les réponses strictement antérieures à cette date ISO. */
  before?: string;
  /** 500 par défaut, 1 000 maximum. */
  limit?: number;
};

export async function listResponses(
  actor: Actor,
  fileId: string,
  options: ListResponsesOptions = {},
): Promise<{ questions: QuestionView[]; responses: ResponseView[] }> {
  const form = await requireFormEditor(actor, fileId);
  const questions = await loadQuestions(form.id);

  const requested = options.limit ?? 500;
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), 1000)
    : 500;

  const conditions = [eq(formResponses.formId, form.id)];
  if (options.before !== undefined) {
    const before = new Date(options.before);
    if (Number.isNaN(before.getTime())) {
      throw new FormsError("validation", "Date de pagination invalide.");
    }
    conditions.push(lt(formResponses.submittedAt, before));
  }

  const rows = await db()
    .select()
    .from(formResponses)
    .where(and(...conditions))
    .orderBy(desc(formResponses.submittedAt))
    .limit(limit);
  return {
    questions,
    responses: rows.map((row) => ({
      id: row.id,
      submittedAt: row.submittedAt.toISOString(),
      answers: row.answers,
    })),
  };
}

function csvCell(value: string): string {
  // Neutralise l'injection de formules (=, +, -, @, tabulation, CR) avant
  // l'échappement CSV : un tableur traiterait sinon la valeur comme une
  // formule. Guillemets, points-virgules et retours à la ligne forcent le
  // placement entre guillemets, guillemets internes doublés.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",;\r\n]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

function formatAnswer(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(" | ");
  return value ?? "";
}

const EXPORT_PAGE_SIZE = 500;

/** Export CSV (BOM UTF-8 pour les tableurs), réservé aux éditeurs. */
export async function exportResponsesCsv(
  actor: Actor,
  fileId: string,
): Promise<{ name: string; contentType: string; body: string }> {
  const form = await requireFormEditor(actor, fileId);
  const questions = await loadQuestions(form.id);

  const header = ["Date", ...questions.map((question) => question.label)];
  const lines = [header.map(csvCell).join(",")];

  // Export complet : pages de 500 réponses jusqu'à la limite du formulaire.
  const seen = new Set<string>();
  let before: string | undefined;
  const maxPages = Math.ceil(MAX_RESPONSES / EXPORT_PAGE_SIZE) + 1;
  for (let page = 0; page < maxPages; page += 1) {
    const { responses } = await listResponses(actor, fileId, {
      limit: EXPORT_PAGE_SIZE,
      ...(before !== undefined ? { before } : {}),
    });
    for (const response of responses) {
      if (seen.has(response.id)) continue;
      seen.add(response.id);
      const row = [
        new Date(response.submittedAt).toLocaleString("fr-FR"),
        ...questions.map((question) => formatAnswer(response.answers[question.id])),
      ];
      lines.push(row.map(csvCell).join(","));
    }
    const last = responses[responses.length - 1];
    if (!last || responses.length < EXPORT_PAGE_SIZE || seen.size >= MAX_RESPONSES) break;
    before = last.submittedAt;
  }

  return {
    name: `${form.title}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: `\uFEFF${lines.join("\n")}\n`,
  };
}
