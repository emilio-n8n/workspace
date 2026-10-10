import { createFileRoute } from "@tanstack/react-router";
import { DriveBrowser } from "../../../features/drive/browser";

export const Route = createFileRoute("/app/drive/shared")({ component: DriveSharedPage });

function DriveSharedPage() {
  return <DriveBrowser view="shared" />;
}
