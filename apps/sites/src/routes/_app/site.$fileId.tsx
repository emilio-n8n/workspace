import { createFileRoute } from "@tanstack/react-router";
import { SiteEditor } from "@workspace/sites/ui";

export const Route = createFileRoute("/_app/site/$fileId")({ component: SitePage });

function SitePage() {
  const { fileId } = Route.useParams();
  return <SiteEditor fileId={fileId} />;
}
