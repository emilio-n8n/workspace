import { createFileRoute } from "@tanstack/react-router";
import { SitesList } from "@workspace/sites/ui";

export const Route = createFileRoute("/_app/")({ component: SitesPage });

function SitesPage() {
  return <SitesList />;
}
