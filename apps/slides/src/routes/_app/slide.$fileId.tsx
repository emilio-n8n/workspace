import { createFileRoute } from "@tanstack/react-router";
import { SlidesEditor } from "@workspace/slides/ui";

export const Route = createFileRoute("/_app/slide/$fileId")({ component: SlidePage });

function SlidePage() {
  const { fileId } = Route.useParams();
  return <SlidesEditor fileId={fileId} />;
}
