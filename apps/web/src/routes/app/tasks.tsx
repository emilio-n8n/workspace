import { createFileRoute } from "@tanstack/react-router";
import { TasksView } from "../../features/tasks/tasks-view";

export const Route = createFileRoute("/app/tasks")({ component: TasksPage });

function TasksPage() {
  return <TasksView />;
}
