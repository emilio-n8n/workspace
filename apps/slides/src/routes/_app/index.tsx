import { createFileRoute } from "@tanstack/react-router";
import { SlidesList } from "@workspace/slides/ui";

export const Route = createFileRoute("/_app/")({ component: SlidesPage });

function SlidesPage() {
  return <SlidesList />;
}
