import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { isWorkspaceScope, WORKSPACE_SCOPES, type WorkspaceScope } from "./scopes";

/**
 * Client better-auth du navigateur uniquement (jamais importé côté serveur).
 * Appelle les routes montées sur `/api/auth/*` de l'application.
 * Ré-exporte les scopes (constants sans dépendance serveur).
 */
export const authClient = createAuthClient({
  baseURL: "",
  plugins: [organizationClient()],
});

export { isWorkspaceScope, WORKSPACE_SCOPES, type WorkspaceScope };
