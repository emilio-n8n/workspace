import { createFileRoute } from "@tanstack/react-router";
import { CoursePage } from "@workspace/classroom/ui";

export const Route = createFileRoute("/_app/course/$courseId")({ component: CourseRoute });

function CourseRoute() {
  const { courseId } = Route.useParams();
  return <CoursePage courseId={courseId} />;
}
