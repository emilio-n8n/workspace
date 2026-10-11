import { createFileRoute } from "@tanstack/react-router";
import { TasksView } from "@workspace/tasks/ui";

export const Route = createFileRoute("/_app/")({ component: TasksPage });

function TasksPage() {
  return <TasksView />;
}
