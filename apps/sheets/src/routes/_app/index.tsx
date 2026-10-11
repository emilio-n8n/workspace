import { createFileRoute } from "@tanstack/react-router";
import { SheetsList } from "@workspace/sheets/ui";

export const Route = createFileRoute("/_app/")({ component: SheetsPage });

function SheetsPage() {
  return <SheetsList />;
}
