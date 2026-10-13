import { recordAudit } from "@workspace/audit";
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
import { and, asc, eq, sql } from "drizzle-orm";
import { checkBlocks, normalizeBlocks, type SiteBlock } from "./blocks.ts";
import { slugify } from "./markdown.ts";
import { type SitePageRow, sitesPages, sitesSites } from "./schema.ts";

/** Type MIME du pointeur Drive d'un site Workspace. */
export const SITES_MIME = "application/vnd.workspace.sites+json";

const DEFAULT_CONTENT =
  "# Bienvenue\n\nCette page est modifiable en Markdown : titres, listes, liens, citations et code.";

export type SitesErrorCode = "not_found" | "forbidden" | "validation" | "conflict";

export class SitesError extends Error {
  readonly code: SitesErrorCode;
  constructor(code: SitesErrorCode, message: string) {
    super(message);
    this.name = "SitesError";
    this.code = code;
  }
}

export type PageView = { id: string; slug: string; title: string; position: number };

export type SiteDetail = {
  fileId: string;
  title: string;
  canEdit: boolean;
  pages: PageView[];
};

export type PageDetail = {
  id: string;
  slug: string;
  title: string;
  content: string;
  blocks: SiteBlock[] | null;
};

/** Entrée de sauvegarde d'une page : `blocks` absent = ne pas y toucher. */
export type SavePageInput = {
  title: string;
  content: string;
  /** Mise en page en blocs ; `null` efface les blocs (retour au Markdown). */
  blocks?: SiteBlock[] | null;
};

const db = () => getDb();

/** Nombre de tentatives en cas de collision de slug avec une création concurrente. */
const MAX_SLUG_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 255) {
    throw new SitesError("validation", "Le titre doit contenir entre 1 et 255 caractères.");
  }
  return trimmed;
}

async function requireSite(
  actor: Actor,
  fileId: string,
): Promise<{ entry: DriveEntry; siteId: string }> {
  let entry: DriveEntry;
  try {
    entry = await getEntry(actor, fileId);
  } catch (error) {
    // Fichier absent, supprimé ou non visible : on ne divulgue pas l'existence
    // du fichier Drive, l'erreur de Sites est toujours « introuvable ».
    if (error instanceof DriveError) throw new SitesError("not_found", "Site introuvable.");
    throw error;
  }
  if (entry.mimeType !== SITES_MIME) {
    throw new SitesError("not_found", "Site introuvable.");
  }
  const [row] = await db().select().from(sitesSites).where(eq(sitesSites.fileId, fileId)).limit(1);
  if (!row || row.orgId !== actor.orgId) {
    throw new SitesError("not_found", "Site introuvable.");
  }
  return { entry, siteId: row.id };
}

async function requireEditor(actor: Actor, fileId: string): Promise<void> {
  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "write")) {
    throw new SitesError("forbidden", "Permission insuffisante pour modifier ce site.");
  }
}

async function requirePage(
  actor: Actor,
  fileId: string,
  pageId: string,
): Promise<{ siteId: string; page: SitePageRow }> {
  const { siteId } = await requireSite(actor, fileId);
  const [page] = await db().select().from(sitesPages).where(eq(sitesPages.id, pageId)).limit(1);
  if (!page || page.siteId !== siteId) {
    throw new SitesError("not_found", "Page introuvable.");
  }
  return { siteId, page };
}

async function listPages(siteId: string): Promise<PageView[]> {
  return (
    db()
      .select({
        id: sitesPages.id,
        slug: sitesPages.slug,
        title: sitesPages.title,
        position: sitesPages.position,
      })
      .from(sitesPages)
      .where(eq(sitesPages.siteId, siteId))
      // `id` (uuidv7, ordonné dans le temps) départage deux positions identiques
      // qu'une création concurrente peut produire avec `max(position) + 1`.
      .orderBy(asc(sitesPages.position), asc(sitesPages.id))
  );
}

/**
 * Premier slug libre pour `title` : `base`, puis `base-2`, `base-3`, …
 * `tried` mémorise les candidats déjà refusés par une insertion concurrente.
 */
async function uniqueSlug(
  siteId: string,
  title: string,
  tried: ReadonlySet<string> = new Set(),
): Promise<string> {
  const base = slugify(title);
  for (let suffix = 1; suffix < 50; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (tried.has(candidate)) continue;
    const [existing] = await db()
      .select({ id: sitesPages.id })
      .from(sitesPages)
      .where(sql`${sitesPages.siteId} = ${siteId} and ${sitesPages.slug} = ${candidate}`)
      .limit(1);
    if (!existing) return candidate;
  }
  throw new SitesError("conflict", "Génération de l'URL de page impossible.");
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

export async function createSite(
  actor: Actor,
  input: { parentFolderId?: string | null; title: string },
): Promise<{ entry: DriveEntry; site: { id: string; fileId: string } }> {
  const title = assertTitle(input.title);

  const entry = await createLinkedFile(actor, {
    parentId: input.parentFolderId ?? null,
    name: title,
    mimeType: SITES_MIME,
  });

  const site = await withTransaction(async (tx) => {
    const [created] = await tx
      .insert(sitesSites)
      .values({ orgId: actor.orgId, fileId: entry.id, createdBy: actor.userId })
      .returning({ id: sitesSites.id, fileId: sitesSites.fileId });
    if (!created) throw new SitesError("conflict", "Création du site impossible.");
    await tx.insert(sitesPages).values({
      siteId: created.id,
      slug: "accueil",
      title: "Accueil",
      position: 0,
      content: DEFAULT_CONTENT,
    });
    return created;
  });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "sites.site.create",
    resourceType: "site",
    resourceId: entry.id,
    result: "success",
  });

  return { entry, site };
}

export async function getSite(actor: Actor, fileId: string): Promise<SiteDetail> {
  const { entry, siteId } = await requireSite(actor, fileId);
  const role = await effectiveRole(actor, fileId);
  return {
    fileId: entry.id,
    title: entry.name,
    canEdit: roleSatisfies(role, "write"),
    pages: await listPages(siteId),
  };
}

export async function getPage(actor: Actor, fileId: string, pageId: string): Promise<PageDetail> {
  const { page } = await requirePage(actor, fileId, pageId);
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    content: page.content,
    // Normalisation défensive : une valeur corrompue en base ne doit jamais
    // casser le rendu de la page (les blocs illisibles sont écartés).
    blocks: page.blocks === null ? null : normalizeBlocks(page.blocks),
  };
}

export async function savePage(
  actor: Actor,
  fileId: string,
  pageId: string,
  input: SavePageInput,
): Promise<PageDetail> {
  const { page } = await requirePage(actor, fileId, pageId);
  await requireEditor(actor, fileId);

  const title = assertTitle(input.title);
  if (input.content.length > 200_000) {
    throw new SitesError("validation", "Contenu de page limité à 200 000 caractères.");
  }

  // `blocks` absent → page Markdown intacte ; `null` → la page redevient
  // Markdown ; un tableau → la page est construite en blocs.
  let blocks: SiteBlock[] | null | undefined = input.blocks === undefined ? undefined : null;
  if (input.blocks != null) {
    const checked = checkBlocks(input.blocks);
    if (checked.error) throw new SitesError("validation", checked.error);
    blocks = checked.blocks;
  }

  await db()
    .update(sitesPages)
    .set({
      title,
      content: input.content,
      ...(blocks === undefined ? {} : { blocks }),
    })
    .where(eq(sitesPages.id, page.id));
  await touchEntry(actor, fileId).catch(() => undefined);

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "sites.page.save",
    resourceType: "site",
    resourceId: fileId,
    result: "success",
    metadata: { pageId: page.id },
  });

  const saved =
    blocks === undefined ? (page.blocks === null ? null : normalizeBlocks(page.blocks)) : blocks;

  // Le slug de la page reste inchangé lors d'un renommage : il est déjà
  // public (URL de page) et des liens externes peuvent le référencer.
  return { id: page.id, slug: page.slug, title, content: input.content, blocks: saved };
}

export async function addPage(
  actor: Actor,
  fileId: string,
  input: { title: string },
): Promise<{ pageId: string; pages: PageView[] }> {
  const { siteId } = await requireSite(actor, fileId);
  await requireEditor(actor, fileId);

  const title = assertTitle(input.title);
  const tried = new Set<string>();

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const slug = await uniqueSlug(siteId, title, tried);
    try {
      const [created] = await db()
        .insert(sitesPages)
        .values({
          siteId,
          slug,
          title,
          // Position en fin de liste, calculée par la base : `count(*)` était
          // faux dès qu'une page était supprimée.
          position: sql<number>`(select coalesce(max(${sitesPages.position}), -1) + 1 from ${sitesPages} where ${sitesPages.siteId} = ${siteId})`,
          content: `# ${title}\n`,
        })
        .returning({ id: sitesPages.id });
      if (!created) throw new SitesError("conflict", "Création de la page impossible.");
      await recordAudit({
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: "sites.page.add",
        resourceType: "site",
        resourceId: fileId,
        result: "success",
        metadata: { pageId: created.id },
      });
      return { pageId: created.id, pages: await listPages(siteId) };
    } catch (error) {
      // Un createSite/addPage concurrent a pris le slug entre la vérification
      // et l'insertion (contrainte d'unicité) : on régénère et on réessaie.
      if (!isUniqueViolation(error)) throw error;
      tried.add(slug);
    }
  }

  throw new SitesError("conflict", "Création de la page impossible après plusieurs tentatives.");
}

export async function deletePage(
  actor: Actor,
  fileId: string,
  pageId: string,
): Promise<PageView[]> {
  const { siteId } = await requirePage(actor, fileId, pageId);
  await requireEditor(actor, fileId);

  // Suppression conditionnelle en une seule requête : la page n'est retirée
  // que si le site conserve au moins une autre page, ce qui évite qu'un
  // contrôle puis suppression concurrents ne vident le site.
  const deleted = await db()
    .delete(sitesPages)
    .where(
      and(
        eq(sitesPages.id, pageId),
        sql`(select count(*) from ${sitesPages} where ${sitesPages.siteId} = ${siteId}) > 1`,
      ),
    )
    .returning({ id: sitesPages.id });
  if (deleted.length === 0) {
    throw new SitesError("validation", "Un site doit conserver au moins une page.");
  }

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "sites.page.delete",
    resourceType: "site",
    resourceId: fileId,
    result: "success",
    metadata: { pageId },
  });

  return listPages(siteId);
}

export async function renameSite(actor: Actor, fileId: string, title: string): Promise<DriveEntry> {
  const clean = assertTitle(title);
  await requireSite(actor, fileId);
  return driveRename(actor, fileId, clean);
}

/** Sites visibles (fichiers Drive liés). */
export async function listSites(
  actor: Actor,
): Promise<{ fileId: string; title: string; updatedAt: string; canEdit: boolean }[]> {
  const rows = await db()
    .select({ fileId: sitesSites.fileId })
    .from(sitesSites)
    .where(eq(sitesSites.orgId, actor.orgId))
    .limit(200);

  const visible: { fileId: string; title: string; updatedAt: string; canEdit: boolean }[] = [];
  for (const row of rows) {
    try {
      const entry = await getEntry(actor, row.fileId);
      const role = await effectiveRole(actor, row.fileId);
      visible.push({
        fileId: entry.id,
        title: entry.name,
        updatedAt: entry.updatedAt.toISOString(),
        canEdit: roleSatisfies(role, "write"),
      });
    } catch {
      // Fichier supprimé ou non visible : ignoré.
    }
  }
  return visible.sort((a, b) => {
    if (a.updatedAt === b.updatedAt) return 0;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
}
