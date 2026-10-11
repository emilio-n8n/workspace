import { createFileRoute } from "@tanstack/react-router";
import { PublicForm } from "@workspace/forms/ui";

export const Route = createFileRoute("/f/$slug")({ component: PublicFormPage });

function PublicFormPage() {
  const { slug } = Route.useParams();
  return <PublicForm slug={slug} />;
}
