import {
  authenticateApiToken,
  type TokenPrincipal,
  tokenHasScope,
  type WorkspaceScope,
} from "@workspace/auth";
import { DriveError, type DriveErrorCode } from "@workspace/drive";

/**
 * Authentification des routes de synchronisation.
 *
 * Le client local présente un jeton d'API (`wsk_…`) émis depuis l'application,
 * exactement comme le serveur MCP. Le jeton porte l'utilisateur et
 * l'organisation ; les services Drive revérifient ensuite les droits sur
 * chaque élément. Aucune session navigateur n'est acceptée ici : un client de
 * synchronisation est un agent, pas une page web.
 */
export type SyncActor = { userId: string; orgId: string };

export type SyncAuth = {
  actor: SyncActor;
  principal: TokenPrincipal;
};

const DRIVE_ERROR_STATUS: Record<DriveErrorCode, number> = {
  validation: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  quota: 507,
};

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}

/** Authentifie la requête ou renvoie directement la réponse d'erreur. */
export async function authenticateSyncRequest(
  request: Request,
  scope: WorkspaceScope,
): Promise<SyncAuth | Response> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) {
    return jsonError(401, "unauthorized", "Jeton requis (Authorization: Bearer).");
  }

  const principal = await authenticateApiToken(token);
  if (!principal) {
    return jsonError(401, "unauthorized", "Jeton invalide, révoqué ou expiré.");
  }
  if (!tokenHasScope(principal, scope)) {
    return jsonError(403, "forbidden", `Scope ${scope} requis pour cette opération.`);
  }

  return {
    actor: { userId: principal.userId, orgId: principal.orgId },
    principal,
  };
}

/** Traduit les erreurs métier Drive en réponses HTTP sans fuite interne. */
export function syncErrorResponse(error: unknown): Response {
  if (error instanceof DriveError) {
    return jsonError(DRIVE_ERROR_STATUS[error.code], error.code, error.message);
  }
  return jsonError(500, "internal_error", "Erreur interne pendant la synchronisation.");
}

/** Sérialise une entrée Drive pour le client (dates ISO, pas de clé de stockage). */
export function syncEntryJson(entry: {
  id: string;
  parentId: string | null;
  kind: "folder" | "file";
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  updatedAt: Date;
}): {
  id: string;
  parentId: string | null;
  kind: "folder" | "file";
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  updatedAt: string;
} {
  return {
    id: entry.id,
    parentId: entry.parentId,
    kind: entry.kind,
    name: entry.name,
    mimeType: entry.mimeType,
    sizeBytes: entry.sizeBytes,
    checksum: entry.checksum,
    updatedAt: entry.updatedAt.toISOString(),
  };
}
