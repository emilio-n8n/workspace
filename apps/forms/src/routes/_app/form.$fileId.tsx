import { createFileRoute } from "@tanstack/react-router";
import { FormBuilder } from "@workspace/forms/ui";

export const Route = createFileRoute("/_app/form/$fileId")({ component: FormPage });

function FormPage() {
  const { fileId } = Route.useParams();
  return <FormBuilder fileId={fileId} />;
}
