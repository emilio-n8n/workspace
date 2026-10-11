import { createFileRoute } from "@tanstack/react-router";
import { CalendarView } from "@workspace/calendar/ui";

export const Route = createFileRoute("/_app/")({ component: CalendarPage });

function CalendarPage() {
  return <CalendarView />;
}
