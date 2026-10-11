import { createFileRoute } from "@tanstack/react-router";
import { AdminView } from "@workspace/admin/ui";

export const Route = createFileRoute("/_app/")({ component: AdminPage });

function AdminPage() {
  return <AdminView />;
}
