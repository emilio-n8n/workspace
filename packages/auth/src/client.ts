import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Client better-auth du navigateur uniquement (jamais importé côté serveur).
 * Appelle les routes montées sur `/api/auth/*` de l'application.
 */
export const authClient = createAuthClient({
  baseURL: "",
  plugins: [organizationClient()],
});
