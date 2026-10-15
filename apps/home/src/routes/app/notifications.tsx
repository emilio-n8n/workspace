import { createFileRoute } from "@tanstack/react-router";
import { Card, CardDescription, CardHeader, CardTitle, PageHeader } from "@workspace/ui";

export const Route = createFileRoute("/app/notifications")({
  component: NotificationsPage,
  head: () => ({
    meta: [
      {
        title: "Notifications — Workspace",
      },
      {
        name: "description",
        content: "Historique des notifications Workspace : partages, assignations et mises à jour.",
      },
    ],
  }),
});

function NotificationsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Partages, tâches assignées et notes de votre espace de travail."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vos notifications</CardTitle>
          <CardDescription>
            Vos notifications s'affichent dans la cloche en haut de chaque application.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
