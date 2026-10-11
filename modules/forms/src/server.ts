import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  createForm,
  getFormByFileId,
  getPublicForm,
  listForms,
  listResponses,
  saveForm,
  submitResponse,
} from "./index.ts";

export type { FormDetail, FormSummary, PublicForm, QuestionView, ResponseView } from "./index.ts";

const questionSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["short_text", "long_text", "choice", "checkbox", "scale"]),
  label: z.string().trim().min(1).max(500),
  required: z.boolean().optional(),
  options: z.array(z.string().max(200)).max(50).optional(),
});

export const listFormsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listForms(actor);
});

export const createFormFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        parentFolderId: z.string().uuid().nullable(),
        title: z.string().trim().min(1).max(255),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const { entry, form } = await createForm(actor, {
      parentFolderId: data.parentFolderId,
      title: data.title,
    });
    return { fileId: entry.id, formId: form.id, slug: form.slug };
  });

export const getFormFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ fileId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getFormByFileId(actor, data.fileId);
  });

export const saveFormFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        title: z.string().trim().min(1).max(255).optional(),
        description: z.string().max(5000).nullish(),
        status: z.enum(["draft", "open", "closed"]).optional(),
        questions: z.array(questionSchema).max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return saveForm(actor, data.fileId, {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.questions !== undefined ? { questions: data.questions } : {}),
    });
  });

export const listResponsesFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ fileId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listResponses(actor, data.fileId);
  });

// --- Collecte publique : pas de session (autorisation par le statut `open`). --

export const getPublicFormFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ slug: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }) => getPublicForm(data.slug));

export const submitResponseFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        slug: z.string().min(1).max(64),
        answers: z.record(
          z.string().min(1).max(64),
          z.union([z.string().max(5000), z.array(z.string().max(200)).max(50)]),
        ),
      })
      .parse(input),
  )
  .handler(async ({ data }) => submitResponse(data.slug, data.answers));
