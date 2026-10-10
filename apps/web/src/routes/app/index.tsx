import { createFileRoute } from "@tanstack/react-router";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui";
import { useEffect, useState } from "react";
import {
  IconCalendar,
  IconFileText,
  IconFolder,
  IconGrid,
  IconHome,
  IconMail,
  IconPresentation,
  IconVideo,
} from "../../components/icons";
import type { WorkspaceInfo } from "../../server/session";
import { getWorkspaceFn } from "../../server/session";

export const Route = createFileRoute("/app/")({ component: DashboardPage });

const modules: { label: string; icon: React.ReactNode; phase: string; summary: string }[] = [
  {
    label: "Drive",
    icon: <IconFolder />,
    phase: "Phase 2",
    summary: "Fichiers, dossiers, partages, versions et corbeille.",
  },
  {
    label: "Docs",
    icon: <IconFileText />,
    phase: "Phase 2",
    summary: "Édition riche, autosave, versions, export — fondé sur Tiptap 3.",
  },
  {
    label: "Sheets",
    icon: <IconGrid />,
    phase: "Phase 3",
    summary: "Tableurs et formules, pont d'échange xlsx maison.",
  },
  {
    label: "Slides",
    icon: <IconPresentation />,
    phase: "Phase 3",
    summary: "Présentations avec scène maison et export PPTX/PDF.",
  },
  {
    label: "Calendar",
    icon: <IconCalendar />,
    phase: "Phase 3",
    summary: "Vues jour/semaine/mois, récurrence et CalDAV.",
  },
  {
    label: "Tasks",
    icon: <IconGrid />,
    phase: "Phase 3",
    summary: "Tâches, listes et échéances partagées.",
  },
  {
    label: "Mail",
    icon: <IconMail />,
    phase: "Phase 4",
    summary: "Messagerie JMAP complète, fondée sur Stalwart.",
  },
  {
    label: "Meet",
    icon: <IconVideo />,
    phase: "Phase 4",
    summary: "Visioconférence LiveKit, TURN inclus.",
  },
];

function DashboardPage() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setWorkspace(await getWorkspaceFn());
      setLoading(false);
    })();
  }, []);

  const org = workspace?.activeOrganization ?? null;
  const isPersonal = org?.slug?.startsWith("perso-");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {loading ? "Chargement…" : `Bonjour ${workspace?.user.name?.split(" ")[0] ?? ""} 👋`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {org
            ? `Vous êtes dans « ${org.name} » — ${isPersonal ? "espace personnel" : "organisation d'équipe"}.`
            : "Chargement de votre espace…"}
        </p>
      </header>

      <section aria-label="Organisation active">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <IconHome />
              </span>
              <div>
                <p className="font-medium">{org?.name ?? "—"}</p>
                <p className="text-sm text-muted-foreground">
                  Identifiant d'organisation : <code className="text-xs">{org?.id ?? "—"}</code>
                </p>
              </div>
            </div>
            <Badge variant={isPersonal ? "default" : "accent"}>
              {isPersonal ? "Espace personnel" : "Équipe"}
            </Badge>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Applications de la suite" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Applications
          </h2>
          <span className="text-xs text-muted-foreground">
            État d'avancement réel — rien de fictif
          </span>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <li key={module.label}>
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{module.icon}</span>
                    <CardTitle className="text-base">{module.label}</CardTitle>
                    <Badge variant="outline" className="ml-auto">
                      {module.phase}
                    </Badge>
                  </div>
                  <CardDescription>{module.summary}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Sécurité du compte">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sécurité</CardTitle>
            <CardDescription>
              Les sessions sont révocables et l'autorisation est vérifiée côté serveur à chaque
              opération. L'agent MCP autorisé utilisera les mêmes règles de permission.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Pour fermer votre session, utilisez le bouton de déconnexion en bas de la colonne de
            gauche.
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
