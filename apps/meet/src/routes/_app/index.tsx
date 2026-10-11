import { createFileRoute } from "@tanstack/react-router";
import { MeetView } from "@workspace/meet/ui";

export const Route = createFileRoute("/_app/")({ component: MeetPage });

function MeetPage() {
  return <MeetView />;
}
