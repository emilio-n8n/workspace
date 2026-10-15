import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auth, requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  addMemberByEmail,
  clampAuditPage,
  clampAuditPageSize,
  eraseUserAccount,
  exportUserData,
  getOverview,
  getPolicies,
  isAuditDate,
  listActiveSessions,
  listAudit,
  listMembers,
  POLICY_RETENTION_MAX_DAYS,
  POLICY_RETENTION_MIN_DAYS,
  removeMember,
  revokeAllSessions,
  revokeSession,
  updateMemberRole,
  updateOrgProfile,
  updatePolicies,
  updateQuota,
} from "./index.ts";

export type {
  ActiveSession,
  AuditEntry,
  AuditListQuery,
  AuditPage,
  MemberFull,
  OrgOverview,
  OrgPolicies,
  UserDataExportBundle,
} from "./index.ts";

export const getOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return getOverview(actor);
});

export const listMembersFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listMembers(actor);
});

/**
 * Compte géré : crée le compte (mot de passe temporaire haché par better-auth,
 * même politique qu'à l'inscription) puis l'ajoute à l'organisation active.
 * Le mot de passe temporaire n'est renvoyé qu'une fois — il est affiché à
 * l'administrateur pour transmission, jamais stocké en clair.
 */
export const createManagedAccountFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().min(2).max(120),
        email: z.string().email(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const email = data.email.trim();
    // 14 caractères aléatoires, assez longs pour la politique de mots de passe.
    const temporaryPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 14);

    const created = await auth.api.signUpEmail({
      body: { name: data.name.trim(), email, password: temporaryPassword },
    });
    const member = await addMemberByEmail(actor, email);

    return { userId: created.user.id, temporaryPassword, member };
  });

export const addMemberFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ email: z.string().trim().min(3).max(255) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return addMemberByEmail(actor, data.email);
  });

export const updateMemberRoleFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ userId: z.string().min(1), role: z.enum(["admin", "member"]) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await updateMemberRole(actor, data.userId, data.role);
    return { ok: true };
  });

export const removeMemberFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ userId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await removeMember(actor, data.userId);
    return { ok: true };
  });

export const updateOrgProfileFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ name: z.string().trim().min(1).max(150) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await updateOrgProfile(actor, { name: data.name });
    return { ok: true };
  });

export const updateQuotaFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ quotaBytes: z.number().int().nonnegative().nullable() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await updateQuota(actor, data.quotaBytes);
    return { ok: true };
  });

export const getPoliciesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return getPolicies(actor);
});

export const updatePoliciesFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        allowExternalSharing: z.boolean().optional(),
        versionRetentionDays: z
          .number()
          .int()
          .min(POLICY_RETENTION_MIN_DAYS)
          .max(POLICY_RETENTION_MAX_DAYS)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await updatePolicies(actor, data);
    return { ok: true };
  });

/**
 * Filtres et pagination du journal — mêmes règles que `listAudit` : dates ISO
 * validées, `pageSize` borné à 10..100 (défaut 50), `page` ≥ 1.
 */
const auditQueryValidator = z.object({
  action: z.string().trim().max(120).optional(),
  actorId: z.string().trim().max(64).optional(),
  from: z.string().trim().refine(isAuditDate, "Date invalide (format AAAA-MM-JJ).").optional(),
  to: z.string().trim().refine(isAuditDate, "Date invalide (format AAAA-MM-JJ).").optional(),
  page: z
    .number()
    .int()
    .optional()
    .transform((value) => clampAuditPage(value)),
  pageSize: z
    .number()
    .int()
    .optional()
    .transform((value) => clampAuditPageSize(value)),
});

/** Journal d'audit filtré et paginé — sans argument : première page par défaut. */
export const listAuditFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => auditQueryValidator.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listAudit(actor, data);
  });

export const listActiveSessionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listActiveSessions(actor);
});

export const revokeSessionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ sessionId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await revokeSession(actor, data.sessionId);
    return { ok: true };
  });

export const revokeAllSessionsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ userId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return revokeAllSessions(actor, data.userId);
  });

/**
 * Export RGPD des données d'un membre — GET `?userId=` : le bundle complet est
 * construit côté serveur (autorisation revérifiée à chaque appel).
 */
export const exportUserDataFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ userId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return exportUserData(actor, data.userId);
  });

/** Efface (pseudonymise) le compte d'un membre — confirmation « EFFACER » exigée. */
export const eraseUserAccountFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ userId: z.string().min(1), confirm: z.string() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return eraseUserAccount(actor, data.userId, { confirm: data.confirm });
  });
