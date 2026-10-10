import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { DriveBrowser } from "../../../features/drive/browser";
import { entryDetailsFn } from "../../../server/drive";

export const Route = createFileRoute("/app/drive/$entryId")({ component: DriveFolderPage });

/**
 * L'identifiant doit référencer un dossier accessible. Sinon : retour à la
 * racine du Drive (les fichiers s'ouvrent depuis la liste, pas par URL directe).
 */
function DriveFolderPage() {
  const { entryId } = Route.useParams();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const details = await entryDetailsFn({ data: { entryId } });
        if (cancelled) return;
        if (details.entry.kind !== "folder") {
          void router.navigate({ to: "/app/drive" });
        }
      } catch {
        if (!cancelled) void router.navigate({ to: "/app/drive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId, router]);

  return <DriveBrowser folderId={entryId} />;
}
