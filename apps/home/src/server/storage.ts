import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { schema as coreSchema, getDb } from "@workspace/database";
import { driveFiles } from "@workspace/drive";
import { eq, sql } from "drizzle-orm";

/** Consommation de stockage de l'organisation (tous statuts confondus). */
export const getStorageUsageFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const { actor } = await requireActor(request.headers);
  const db = getDb();

  const [usage] = await db
    .select({
      usedBytes: sql<number>`coalesce(sum(${driveFiles.sizeBytes}), 0)`.mapWith(Number),
      fileCount: sql<number>`count(*)`.mapWith(Number),
    })
    .from(driveFiles)
    .where(eq(driveFiles.orgId, actor.orgId));

  const [settings] = await db
    .select({ quotaBytes: coreSchema.orgSettings.storageQuotaBytes })
    .from(coreSchema.orgSettings)
    .where(eq(coreSchema.orgSettings.orgId, actor.orgId))
    .limit(1);

  return {
    usedBytes: usage?.usedBytes ?? 0,
    fileCount: usage?.fileCount ?? 0,
    quotaBytes: settings?.quotaBytes ?? null,
  };
});
