import { createFileRoute } from "@tanstack/react-router";
import { DrivePage } from "../../features/drive-page.tsx";

export const Route = createFileRoute("/_app/shared")({ component: DriveSharedPage });

function DriveSharedPage() {
  return <DrivePage view="shared" />;
}
