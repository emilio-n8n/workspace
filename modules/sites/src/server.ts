import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  addPage,
  createSite,
  deletePage,
  getPage,
  getSite,
  listSites,
  renameSite,
  savePage,
} from "./index.ts";

export type { PageDetail, PageView, SiteDetail } from "./index.ts";

export const listSitesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listSites(actor);
});

export const createSiteFn = createServerFn({ method: "POST" })
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
    const { entry, site } = await createSite(actor, {
      parentFolderId: data.parentFolderId,
      title: data.title,
    });
    return { fileId: entry.id, siteId: site.id };
  });

export const getSiteFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ fileId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getSite(actor, data.fileId);
  });

export const getPageFn = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z.object({ fileId: z.string().uuid(), pageId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getPage(actor, data.fileId, data.pageId);
  });

export const savePageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        pageId: z.string().uuid(),
        title: z.string().trim().min(1).max(255),
        content: z.string().max(200_000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return savePage(actor, data.fileId, data.pageId, {
      title: data.title,
      content: data.content,
    });
  });

export const addPageFn = createServerFn({ method: "POST" })
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
    return addPage(actor, data.fileId, { title: data.title });
  });

export const deletePageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ fileId: z.string().uuid(), pageId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return deletePage(actor, data.fileId, data.pageId);
  });

export const renameSiteFn = createServerFn({ method: "POST" })
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
    const entry = await renameSite(actor, data.fileId, data.title);
    return { title: entry.name };
  });
