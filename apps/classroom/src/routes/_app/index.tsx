import { createFileRoute } from "@tanstack/react-router";
import { ClassroomView } from "@workspace/classroom/ui";

export const Route = createFileRoute("/_app/")({ component: ClassroomPage });

function ClassroomPage() {
  return <ClassroomView />;
}
