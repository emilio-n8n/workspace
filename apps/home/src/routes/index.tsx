import { createFileRoute } from "@tanstack/react-router";
import {
  Badge,
  Button,
  currentTheme,
  IconMoon,
  IconSun,
  SUITE_APPS,
  type Theme,
  toggleTheme,
} from "@workspace/ui";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({ component: HomePage });

// Dérivé du registre unique de la suite : plus jamais de liste en dur périmée.
const suiteApps = SUITE_APPS.map((app) => ({
  label: app.name,
  icon: <app.Icon />,
  phase: `Phase ${app.phase}`,
}));

const principles = [
  {
    title: "Une seule suite",
    body: "Une identité visuelle, des comptes, des fichiers et des permissions partagés entre toutes les applications.",
  },
  {
    title: "Autonome",
    body: "Chaque organisation héberge sa propre instance. Aucune dépendance à un service propriétaire.",
  },
  {
    title: "Sécurisée par construction",
    body: "Autorisation côté serveur, isolation des organisations, sessions révocables, journal d'audit.",
  },
  {
    title: "Prête pour l'IA",
    body: "Un serveur MCP officiel, avec jetons scopés et révocables, respecte exactement vos permissions.",
  },
];

function HomePage() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 items-center gap-3 border-b border-border px-4 md:px-6">
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-sm bg-primary text-[10px] font-bold text-primary-foreground">
            W
          </span>
          <span className="font-semibold tracking-tight">Workspace</span>
        </span>
        <span className="hidden text-xs text-muted-foreground sm:block">
          open source · auto-hébergeable
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(toggleTheme())}
            aria-label={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
          >
            {theme === "dark" ? <IconSun /> : <IconMoon />}
          </Button>
          <a href="/login">
            <Button variant="ghost" size="sm">
              Connexion
            </Button>
          </a>
          <a href="/signup">
            <Button size="sm">Créer un compte</Button>
          </a>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[1.2fr_1fr] md:py-24">
          <div className="flex flex-col gap-6">
            <Badge variant="accent" className="w-fit">
              En construction active · fondations livrées
            </Badge>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
              La suite bureautique libre,{" "}
              <span className="text-muted-foreground">auto-hébergeable</span> et prête pour l'IA.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              Drive, Docs, Sheets, Slides, Mail, Calendar, Meet et bien plus — une seule suite,
              cohérente et rapide, qui appartient à ceux qui l'utilisent. Et un serveur MCP officiel
              pour la piloter avec des agents IA autorisés.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a href="/app">
                <Button size="lg">Ouvrir l'application</Button>
              </a>
              <a href="/signup">
                <Button size="lg" variant="outline">
                  Créer un compte
                </Button>
              </a>
            </div>
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Licence</dt>
                <dd className="font-medium">AGPL-3.0-only</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Déploiement</dt>
                <dd className="font-medium">Docker, chez vous</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Données</dt>
                <dd className="font-medium">PostgreSQL + S3/local</dd>
              </div>
            </dl>
          </div>

          <aside className="rounded-xl border border-border bg-card p-6 shadow-xs">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Applications
            </h2>
            <ul className="mt-4 flex flex-col divide-y divide-border">
              {suiteApps.map((app) => (
                <li key={app.label} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">{app.icon}</span>
                  <span className="font-medium">{app.label}</span>
                  <Badge variant="outline" className="ml-auto">
                    {app.phase}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">
              L'avancement affiché est l'avancement réel : nous n'annonçons pas de fonctionnalité
              avant qu'elle ne fonctionne.
            </p>
          </aside>
        </section>

        <section className="border-t border-border bg-muted/40">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 md:grid-cols-4">
            {principles.map((principle) => (
              <div key={principle.title} className="flex flex-col gap-2">
                <h3 className="font-semibold tracking-tight">{principle.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{principle.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="flex h-12 items-center justify-between border-t border-border px-4 text-xs text-muted-foreground md:px-6">
        <span>Workspace — suite bureautique open source</span>
        <span>AGPL-3.0 · auto-hébergée · vérifiable</span>
      </footer>
    </div>
  );
}
