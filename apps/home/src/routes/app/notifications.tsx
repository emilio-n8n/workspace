import { createFileRoute } from "@tanstack/react-router";
import { Card, CardDescription, CardHeader, CardTitle } from "@workspace/ui";

export const Route = createFileRoute("/app/notifications")({ component: NotificationsPage });

function NotificationsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Partages, tâches assignées et notes de votre espace de travail.
        </p>
      </header>

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
