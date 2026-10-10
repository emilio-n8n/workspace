import { createFileRoute } from "@tanstack/react-router";
import { DriveBrowser } from "../../../features/drive/browser";

export const Route = createFileRoute("/app/drive/recent")({ component: DriveRecentPage });

function DriveRecentPage() {
  return <DriveBrowser view="recent" />;
}
