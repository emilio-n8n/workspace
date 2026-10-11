import { createFileRoute } from "@tanstack/react-router";
import { FormsList } from "@workspace/forms/ui";

export const Route = createFileRoute("/_app/")({ component: FormsPage });

function FormsPage() {
  return <FormsList />;
}
