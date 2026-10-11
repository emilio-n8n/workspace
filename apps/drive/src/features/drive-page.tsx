import { DriveBrowser } from "@workspace/drive/ui";
import { useEffect, useState } from "react";
import { createDocumentFromDriveFn } from "../server/app.ts";
import { getAppUrlsFn } from "../server/context.ts";

type Props = {
  view?: "drive" | "recent" | "shared";
  folderId?: string | null;
};

/** Page Drive d'une vue : résout l'URL Docs et branche la création de documents. */
export function DrivePage({ view = "drive", folderId = null }: Props) {
  const [docsUrl, setDocsUrl] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const urls = await getAppUrlsFn();
      setDocsUrl(urls.docs);
    })();
  }, []);

  if (!docsUrl) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  return (
    <DriveBrowser
      view={view}
      folderId={folderId}
      docsUrl={docsUrl}
      createDocument={async (parentId, title) => {
        const created = await createDocumentFromDriveFn({
          data: { parentFolderId: parentId, title },
        });
        return { fileId: created.fileId };
      }}
    />
  );
}
