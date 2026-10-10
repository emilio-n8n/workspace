import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@workspace/auth";

/**
 * Montage du gestionnaire better-auth sur `/api/auth/*`.
 * better-auth gère les réponses (cookies httpOnly, jetons) et applique ses
 * propres contrôles (rate limiting, vérification, révocation de session).
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
