import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  createRootRoute,
  type ErrorComponentProps,
  HeadContent,
  Link,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { BrandMark, themeInitScript } from "@workspace/ui";
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
        title: "Workspace — la suite bureautique libre et auto-hébergeable",
      },
      {
        name: "description",
        content:
          "Workspace est une suite bureautique libre et auto-hébergeable : Drive, Docs, Sheets, Slides, Calendar, Tasks, Forms, Mail, Chat, Meet, Sites, Classroom et Admin, avec un serveur MCP autorisé par jetons scopés.",
      },
      { property: "og:title", content: "Workspace — la suite bureautique libre" },
      {
        property: "og:description",
        content:
          "Suite bureautique libre et auto-hébergeable : vos données vivent chez vous, avec agents IA autorisés par jetons scopés et révocables.",
      },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "fr_FR" },
      { property: "og:image", content: "/pwa/icon.svg" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Workspace — la suite bureautique libre" },
      {
        name: "twitter:description",
        content: "Suite bureautique libre et auto-hébergeable, avec permissions révisées côté serveur.",
      },
      { name: "twitter:image", content: "/pwa/icon.svg" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/pwa/icon.svg" },
      { rel: "apple-touch-icon", href: "/pwa/maskable.svg" },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFoundDocument,
  errorComponent: ErrorDocument,
});

function NotFoundDocument() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center shadow-soft">
        <BrandMark />
        <h1 className="font-display text-2xl font-semibold tracking-tight">Page introuvable</h1>
        <p className="text-sm text-muted-foreground">
          La page demandée n'existe pas ou a été déplacée.
        </p>
        <Link
          to="/"
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
        >
          Revenir à l'accueil
        </Link>
      </div>
    </main>
  );
}

function ErrorDocument({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center shadow-soft">
        <BrandMark />
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Une erreur est survenue
        </h1>
        <p className="text-sm text-muted-foreground">Réessayez ou revenez à l'accueil.</p>
        <p className="break-words text-xs text-muted-foreground">{message}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
          >
            Réessayer
          </button>
          <Link to="/" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Revenir à l'accueil
          </Link>
        </div>
      </div>
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
