import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  addTab,
  createSpreadsheet,
  deleteTab,
  getSpreadsheet,
  listSpreadsheets,
  renameSpreadsheet,
  renameTab,
  saveCells,
} from "./index.ts";

export type { CellView, SpreadsheetDetail, TabView } from "./index.ts";

export const listSpreadsheetsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listSpreadsheets(actor);
});

export const createSpreadsheetFn = createServerFn({ method: "POST" })
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
    const { entry, spreadsheet } = await createSpreadsheet(actor, {
      parentFolderId: data.parentFolderId,
      title: data.title,
    });
    return { fileId: entry.id, spreadsheetId: spreadsheet.id };
  });

export const getSpreadsheetFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ fileId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getSpreadsheet(actor, data.fileId);
  });

export const saveCellsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        tabId: z.string().uuid(),
        updates: z
          .array(
            z.object({
              row: z.number().int().min(0),
              col: z.number().int().min(0),
              value: z.string().max(1000),
            }),
          )
          .max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return saveCells(actor, data.fileId, { tabId: data.tabId, updates: data.updates });
  });

export const addTabFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return addTab(actor, data.fileId, data.name);
  });

export const renameTabFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        tabId: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await renameTab(actor, data.tabId, data.name);
    return { ok: true };
  });

export const deleteTabFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ tabId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteTab(actor, data.tabId);
    return { ok: true };
  });

export const renameSpreadsheetFn = createServerFn({ method: "POST" })
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
    const entry = await renameSpreadsheet(actor, data.fileId, data.title);
    return { title: entry.name };
  });
