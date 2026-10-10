import { createFileRoute } from "@tanstack/react-router";
import { DriveBrowser } from "../../../features/drive/browser";

export const Route = createFileRoute("/app/drive/")({ component: DriveRootPage });

function DriveRootPage() {
  return <DriveBrowser folderId={null} />;
}
