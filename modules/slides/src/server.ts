import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  createPresentation,
  getPresentation,
  listPresentations,
  renamePresentation,
  savePresentation,
} from "./index.ts";

export type { ElementView, PresentationDetail, SlideView } from "./index.ts";

const elementSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["text", "shape"]),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  text: z.string().max(2000),
  fontSize: z.number().int().min(8).max(200),
  bold: z.boolean(),
  align: z.enum(["left", "center", "right"]),
});

const slideSchema = z.object({
  id: z.string().optional(),
  title: z.string().max(255).nullish(),
  notes: z.string().max(5000).nullish(),
  elements: z.array(elementSchema).max(100),
});

export const listPresentationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listPresentations(actor);
});

export const createPresentationFn = createServerFn({ method: "POST" })
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
    const { entry, presentation } = await createPresentation(actor, {
      parentFolderId: data.parentFolderId,
      title: data.title,
    });
    return { fileId: entry.id, presentationId: presentation.id };
  });

export const getPresentationFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ fileId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getPresentation(actor, data.fileId);
  });

export const savePresentationFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        revision: z.number().int().min(1),
        slides: z.array(slideSchema).min(1).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return savePresentation(actor, data.fileId, {
      revision: data.revision,
      slides: data.slides,
    });
  });

export const renamePresentationFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        title: z.string().trim().min(1).max(255),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const entry = await renamePresentation(actor, data.fileId, data.title);
    return { title: entry.name };
  });
