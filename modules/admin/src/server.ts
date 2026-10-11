import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  addMemberByEmail,
  getOverview,
  listAudit,
  listMembers,
  removeMember,
  updateMemberRole,
  updateOrgProfile,
  updateQuota,
} from "./index.ts";

export type { AuditEntry, MemberFull, OrgOverview } from "./index.ts";

export const getOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return getOverview(actor);
});

export const listMembersFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listMembers(actor);
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

export const listAuditFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listAudit(actor, 100);
});
