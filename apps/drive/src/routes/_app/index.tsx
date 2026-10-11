import { createFileRoute } from "@tanstack/react-router";
import { DrivePage } from "../../features/drive-page.tsx";

export const Route = createFileRoute("/_app/")({ component: DriveRootPage });

function DriveRootPage() {
  return <DrivePage folderId={null} />;
}
