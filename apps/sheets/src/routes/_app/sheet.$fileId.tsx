import { createFileRoute } from "@tanstack/react-router";
import { SheetEditor } from "@workspace/sheets/ui";

export const Route = createFileRoute("/_app/sheet/$fileId")({ component: SheetPage });

function SheetPage() {
  const { fileId } = Route.useParams();
  return <SheetEditor fileId={fileId} />;
}
