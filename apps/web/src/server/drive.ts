import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { schema as coreSchema, getDb } from "@workspace/database";
import {
  accessShareLink,
  createFolder,
  createShareLink,
  type DriveEntry,
  DriveError,
  getAncestors,
  getEntry,
  listEntries,
  listEntryGrants,
  listShareLinks,
  listTrash,
  listVersions,
  purge,
  rename,
  restore,
  revokeShareLink,
  shareEntry,
  trash,
  unshareEntry,
} from "@workspace/drive";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireActor } from "./actor.ts";

export type DriveEntryView = {
  id: string;
  kind: "folder" | "file";
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  updatedAt: string;
  isOwner: boolean;
};

export type BreadcrumbItem = { id: string; name: string };

export type GrantView = {
  id: string;
  subjectKind: "user" | "group" | "org";
  subjectLabel: string;
  role: string;
  createdAt: string;
};

export type ShareLinkView = {
  id: string;
  role: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

function toView(entry: DriveEntry, userId: string): DriveEntryView {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    mimeType: entry.mimeType,
    sizeBytes: entry.sizeBytes,
    updatedAt: entry.updatedAt.toISOString(),
    isOwner: entry.ownerId === userId,
  };
}

const idInput = z.object({ entryId: z.string().uuid() });
const parentInput = z.object({ parentId: z.string().uuid().nullable() });

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export const listDriveFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => parentInput.parse(input))
  .handler(async ({ data }): Promise<DriveEntryView[]> => {
    const { actor, userId } = await requireActor(getRequest().headers);
    const entries = await listEntries(actor, { parentId: data.parentId });
    return entries.map((entry) => toView(entry, userId));
  });

export const breadcrumbFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }): Promise<BreadcrumbItem[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const chain = await getAncestors(actor, data.entryId);
    return chain.map((entry) => ({ id: entry.id, name: entry.name }));
  });

export const entryDetailsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const { actor, userId } = await requireActor(getRequest().headers);
    const entry = await getEntry(actor, data.entryId, { allowTrashed: true });
    const versions = entry.kind === "file" ? await listVersions(actor, entry.id) : [];
    return {
      entry: toView(entry, userId),
      status: entry.status,
      versions: versions.map((version) => ({
        id: version.id,
        version: version.version,
        sizeBytes: version.sizeBytes,
        createdAt: version.createdAt.toISOString(),
      })),
    };
  });

export const listTrashFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DriveEntryView[]> => {
    const { actor, userId } = await requireActor(getRequest().headers);
    const rows = await listTrash(actor);
    return rows.map((entry) => toView(entry, userId));
  },
);

export const listVersionsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const versions = await listVersions(actor, data.entryId);
    return versions.map((version) => ({
      id: version.id,
      version: version.version,
      sizeBytes: version.sizeBytes,
      createdAt: version.createdAt.toISOString(),
    }));
  });

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const createFolderInput = z.object({
  parentId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(255),
});

export const createFolderFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => createFolderInput.parse(input))
  .handler(async ({ data }) => {
    const { actor, userId } = await requireActor(getRequest().headers);
    const entry = await createFolder(actor, { parentId: data.parentId, name: data.name });
    return toView(entry, userId);
  });

const renameInput = z.object({
  entryId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
});

export const renameEntryFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => renameInput.parse(input))
  .handler(async ({ data }) => {
    const { actor, userId } = await requireActor(getRequest().headers);
    const entry = await rename(actor, data.entryId, data.name);
    return toView(entry, userId);
  });

export const trashEntryFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await trash(actor, data.entryId);
    return { ok: true };
  });

export const restoreEntryFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await restore(actor, data.entryId);
    return { ok: true };
  });

export const purgeEntryFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await purge(actor, data.entryId);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Partage
// ---------------------------------------------------------------------------

export const listGrantsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }): Promise<GrantView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const grants = await listEntryGrants(actor, data.entryId);
    const db = getDb();

    const views: GrantView[] = [];
    for (const grant of grants) {
      let label = grant.subjectId;
      if (grant.subjectType === "user") {
        const [row] = await db
          .select({ name: coreSchema.user.name, email: coreSchema.user.email })
          .from(coreSchema.user)
          .where(eq(coreSchema.user.id, grant.subjectId))
          .limit(1);
        label = row ? `${row.name} (${row.email})` : grant.subjectId;
      } else if (grant.subjectType === "group") {
        const [row] = await db
          .select({ name: coreSchema.team.name })
          .from(coreSchema.team)
          .where(eq(coreSchema.team.id, grant.subjectId))
          .limit(1);
        label = row ? `Équipe : ${row.name}` : grant.subjectId;
      } else {
        label = "Toute l'organisation";
      }
      views.push({
        id: grant.id,
        subjectKind: grant.subjectType,
        subjectLabel: label,
        role: grant.role,
        createdAt: grant.createdAt.toISOString(),
      });
    }
    return views;
  });

const shareInput = z.object({
  entryId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["viewer", "commenter", "editor"]),
});

export const shareByEmailFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => shareInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const db = getDb();

    const [member] = await db
      .select({ userId: coreSchema.user.id })
      .from(coreSchema.user)
      .innerJoin(
        coreSchema.member,
        and(
          eq(coreSchema.member.userId, coreSchema.user.id),
          eq(coreSchema.member.organizationId, actor.orgId),
        ),
      )
      .where(eq(coreSchema.user.email, data.email.toLowerCase()))
      .limit(1);

    if (!member) {
      throw new DriveError("validation", "Cette personne n'est pas membre de l'organisation.");
    }

    await shareEntry(actor, data.entryId, {
      subject: { kind: "user", id: member.userId },
      role: data.role,
    });
    return { ok: true };
  });

const unshareInput = z.object({ entryId: z.string().uuid(), grantId: z.string().uuid() });

export const unshareFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => unshareInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const removed = await unshareEntry(actor, data.entryId, data.grantId);
    return { removed };
  });

export const listShareLinksFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => idInput.parse(input))
  .handler(async ({ data }): Promise<ShareLinkView[]> => {
    const { actor } = await requireActor(getRequest().headers);
    const links = await listShareLinks(actor, data.entryId);
    return links.map((link) => ({
      id: link.id,
      role: link.role,
      createdAt: link.createdAt.toISOString(),
      lastUsedAt: link.lastUsedAt?.toISOString() ?? null,
      expiresAt: link.expiresAt?.toISOString() ?? null,
      revokedAt: link.revokedAt?.toISOString() ?? null,
    }));
  });

const createLinkInput = z.object({
  entryId: z.string().uuid(),
  role: z.enum(["viewer", "editor"]),
});

export const createShareLinkFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => createLinkInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const link = await createShareLink(actor, data.entryId, { role: data.role });
    return { id: link.id, token: link.token };
  });

export const revokeShareLinkFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ linkId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const revoked = await revokeShareLink(actor, data.linkId);
    return { revoked };
  });

// ---------------------------------------------------------------------------
// Accès public via lien de partage (aucune session requise)
// ---------------------------------------------------------------------------

export const resolveShareFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ token: z.string().min(16) }).parse(input))
  .handler(async ({ data }) => {
    const access = await accessShareLink(data.token);
    if (!access) return null;
    return {
      name: access.entry.name,
      kind: access.entry.kind,
      mimeType: access.entry.mimeType,
      sizeBytes: access.entry.sizeBytes,
      role: access.role,
    };
  });
