import { createFileRoute } from "@tanstack/react-router";
import { DrivePage } from "../../features/drive-page.tsx";

export const Route = createFileRoute("/_app/recent")({ component: DriveRecentPage });

function DriveRecentPage() {
  return <DrivePage view="recent" />;
}
