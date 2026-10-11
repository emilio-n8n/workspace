import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  createRootRoute,
  type ErrorComponentProps,
  HeadContent,
  Link,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { themeInitScript } from "@workspace/ui";
import { type ReactNode, useEffect } from "react";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Tasks — Workspace",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFoundDocument,
  errorComponent: ErrorDocument,
});

function NotFoundDocument() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground">
      <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page introuvable</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        L'adresse demandée n'existe pas ou a été déplacée.
      </p>
      <Link
        to="/"
        className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Revenir à l'accueil
      </Link>
    </main>
  );
}

function ErrorDocument({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground">
      <h1 className="text-2xl font-semibold tracking-tight">Une erreur est survenue</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        L'opération n'a pas pu aboutir. Réessayez ; si le problème persiste, consultez les journaux
        de l'instance.
      </p>
      {import.meta.env.DEV ? (
        <p className="max-w-lg text-xs text-muted-foreground/70">{message}</p>
      ) : null}
      <Link
        to="/"
        className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Revenir à l'accueil
      </Link>
    </main>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Marqueur d'hydratation : les tests E2E et les scripts attendent cet état.
    document.documentElement.dataset.hydrated = "true";
  }, []);

  return (
    <html lang="fr">
      <head>
        {/* Applique le thème avant la première peinture (évite le flash). */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: script statique interne, constante contrôlée (thème). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
        {import.meta.env.DEV ? (
          <TanStackDevtools
            config={{ position: "bottom-right" }}
            plugins={[{ name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> }]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  );
}
