import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
        Workspace
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">
        La suite bureautique open source, auto-hébergeable et pilotable par vos agents.
      </h1>
      <p className="leading-relaxed text-muted-foreground">
        Fondations en construction — Phase 1 : authentification, organisations, permissions et
        stockage. Ceci est un jalon technique, pas encore un produit.
      </p>
    </main>
  );
}
