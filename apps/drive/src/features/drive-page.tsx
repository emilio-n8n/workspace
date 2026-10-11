import { DriveBrowser } from "@workspace/drive/ui";
import { useEffect, useState } from "react";
import {
  createDocumentFromDriveFn,
  createFormFromDriveFn,
  createPresentationFromDriveFn,
  createSpreadsheetFromDriveFn,
} from "../server/app.ts";
import { getAppUrlsFn } from "../server/context.ts";

type Props = {
  view?: "drive" | "recent" | "shared";
  folderId?: string | null;
};

type UrlSet = { docs: string; sheets: string; slides: string; forms: string };

/** Page Drive d'une vue : résout les URLs des applications et branche les créations. */
export function DrivePage({ view = "drive", folderId = null }: Props) {
  const [urls, setUrls] = useState<UrlSet | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const appUrls = await getAppUrlsFn();
        setUrls({
          docs: appUrls.docs,
          sheets: appUrls.sheets,
          slides: appUrls.slides,
          forms: appUrls.forms,
        });
      } catch {
        setLoadError(true);
      }
    })();
  }, []);

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-destructive">Impossible de charger le Drive.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (!urls) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  return (
    <DriveBrowser
      view={view}
      folderId={folderId}
      docsUrl={urls.docs}
      sheetsUrl={urls.sheets}
      slidesUrl={urls.slides}
      formsUrl={urls.forms}
      createDocument={async (parentId, title) => {
        const created = await createDocumentFromDriveFn({
          data: { parentFolderId: parentId, title },
        });
        return { fileId: created.fileId };
      }}
      createSpreadsheet={async (parentId, title) => {
        const created = await createSpreadsheetFromDriveFn({
          data: { parentFolderId: parentId, title },
        });
        return { fileId: created.fileId };
      }}
      createPresentation={async (parentId, title) => {
        const created = await createPresentationFromDriveFn({
          data: { parentFolderId: parentId, title },
        });
        return { fileId: created.fileId };
      }}
      createForm={async (parentId, title) => {
        const created = await createFormFromDriveFn({
          data: { parentFolderId: parentId, title },
        });
        return { fileId: created.fileId };
      }}
    />
  );
}
