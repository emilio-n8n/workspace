import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import { MAX_DIMENSION_SIZES } from "./dimensions.ts";
import { CELL_STORED_FORMAT_IDS } from "./number-format.ts";
import {
  addTab,
  createSpreadsheet,
  deleteColumns,
  deleteRows,
  deleteTab,
  getSpreadsheet,
  importCsv,
  insertColumns,
  insertRows,
  listSpreadsheets,
  renameSpreadsheet,
  renameTab,
  saveCells,
  setCellStyle,
  setDimensionSizes,
} from "./service.ts";
import { CELL_STYLE_BACKGROUNDS, CELL_TEXT_COLORS, MAX_STYLE_CELLS } from "./style-palette.ts";

export type { CellView, DimensionSize, SpreadsheetDetail, TabView } from "./index.ts";

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

export const setCellStyleFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        tabId: z.string().uuid(),
        cells: z
          .array(
            z.object({
              row: z.number().int().min(0),
              col: z.number().int().min(0),
            }),
          )
          .min(1)
          .max(MAX_STYLE_CELLS),
        style: z
          .object({
            bold: z.literal(true).optional(),
            italic: z.literal(true).optional(),
            underline: z.literal(true).optional(),
            strike: z.literal(true).optional(),
            align: z.enum(["left", "center", "right"]).optional(),
            background: z.enum(CELL_STYLE_BACKGROUNDS).optional(),
            color: z.enum(CELL_TEXT_COLORS).optional(),
            format: z.enum(CELL_STORED_FORMAT_IDS).optional(),
          })
          .nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return setCellStyle(actor, data.fileId, {
      tabId: data.tabId,
      cells: data.cells,
      style: data.style,
    });
  });

export const setDimensionSizesFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        tabId: z.string().uuid(),
        sizes: z
          .array(
            z.object({
              axis: z.enum(["col", "row"]),
              index: z.number().int().min(0),
              size: z.number().int(),
            }),
          )
          .min(1)
          .max(MAX_DIMENSION_SIZES),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return setDimensionSizes(actor, data.fileId, {
      tabId: data.tabId,
      sizes: data.sizes,
    });
  });

/** Valide une opération structurelle (index et nombre d'éléments). */
const structureInput = z.object({
  fileId: z.string().uuid(),
  tabId: z.string().uuid(),
  index: z.number().int().min(0),
  count: z.number().int().min(1).max(100).optional(),
});

export const insertRowsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => structureInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await insertRows(actor, data.fileId, {
      tabId: data.tabId,
      index: data.index,
      count: data.count,
    });
    return { ok: true };
  });

export const insertColumnsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => structureInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await insertColumns(actor, data.fileId, {
      tabId: data.tabId,
      index: data.index,
      count: data.count,
    });
    return { ok: true };
  });

export const deleteRowsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => structureInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteRows(actor, data.fileId, {
      tabId: data.tabId,
      index: data.index,
      count: data.count,
    });
    return { ok: true };
  });

export const deleteColumnsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => structureInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteColumns(actor, data.fileId, {
      tabId: data.tabId,
      index: data.index,
      count: data.count,
    });
    return { ok: true };
  });

export const importCsvFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        tabId: z.string().uuid(),
        text: z.string().max(2_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return importCsv(actor, data.fileId, { tabId: data.tabId, text: data.text });
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
