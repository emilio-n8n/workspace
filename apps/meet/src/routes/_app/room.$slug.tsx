import { createFileRoute } from "@tanstack/react-router";
import { JoinRoom } from "@workspace/meet/ui";

export const Route = createFileRoute("/_app/room/$slug")({ component: RoomPage });

function RoomPage() {
  const { slug } = Route.useParams();
  return <JoinRoom slug={slug} />;
}
