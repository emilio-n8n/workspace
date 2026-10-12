import { getDb, schema } from "@workspace/database";

/** Résultat d'une action journalisée (aligné sur la colonne `audit_events.result`). */
export type AuditResult = "success" | "denied" | "error";

export type AuditInput = {
  orgId: string;
  actorUserId?: string | null;
  actorTokenId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  result: AuditResult;
  metadata?: Record<string, string | number | boolean | null> | null;
};

/** Noms d'erreurs considérées comme un refus d'autorisation. */
const DENIED_ERROR_NAMES: ReadonlySet<string> = new Set([
  "PolicyError",
  "UnauthorizedError",
  "NoOrganizationError",
  "ForbiddenError",
]);

/** Préfixes de messages considérés comme un refus d'autorisation. */
const DENIED_MESSAGE_PREFIXES = ["Permission insuffisante", "Accès", "Refusé"] as const;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (DENIED_ERROR_NAMES.has(error.name)) return true;
  return DENIED_MESSAGE_PREFIXES.some((prefix) => error.message.startsWith(prefix));
}

/**
 * Journalise un événement d'audit. Une panne d'audit ne doit JAMAIS casser le
 * chemin de la requête : elle est signalée sur stderr et avalée.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await getDb()
      .insert(schema.auditEvents)
      .values({
        orgId: input.orgId,
        actorUserId: input.actorUserId ?? null,
        actorTokenId: input.actorTokenId ?? null,
        action: input.action,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        result: input.result,
        metadata: input.metadata ?? null,
      });
  } catch (error) {
    console.error(`[audit] écriture impossible : ${errorText(error)}`);
  }
}

/**
 * Exécute `fn` puis journalise son résultat : `success` en cas de succès,
 * `denied` si l'erreur est un refus d'autorisation, `error` sinon. L'erreur
 * est toujours relancée. L'écriture d'audit elle-même n'échoue jamais.
 */
export async function withAudit<T>(
  input: Omit<AuditInput, "result">,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const value = await fn();
    await recordAudit({ ...input, result: "success" });
    return value;
  } catch (error) {
    await recordAudit({ ...input, result: isDeniedError(error) ? "denied" : "error" });
    throw error;
  }
}
