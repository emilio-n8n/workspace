import { createFileRoute } from "@tanstack/react-router";
import { Badge, Button } from "@workspace/ui";
import { useEffect, useState } from "react";
import { resolveShareFn } from "../../server/drive";

export const Route = createFileRoute("/s/$token")({ component: SharedFilePage });

type SharedFile = {
  name: string;
  kind: "folder" | "file";
  mimeType: string | null;
  sizeBytes: number | null;
  role: string;
};

function formatBytes(size: number | null): string {
  if (size === null) return "—";
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Page publique d'un lien de partage — aucune session requise. */
function SharedFilePage() {
  const { token } = Route.useParams();
  const [file, setFile] = useState<SharedFile | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await resolveShareFn({ data: { token } });
        if (!cancelled) setFile(resolved);
      } catch {
        if (!cancelled) setFile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-foreground">
      <span className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-sm bg-primary text-[10px] font-bold text-primary-foreground">
          W
        </span>
        <span className="font-semibold tracking-tight">Workspace</span>
      </span>

      {file === "loading" ? (
        <p className="text-sm text-muted-foreground">Vérification du lien…</p>
      ) : file === null ? (
        <div className="flex max-w-sm flex-col items-center gap-2 text-center">
          <h1 className="text-lg font-semibold">Lien indisponible</h1>
          <p className="text-sm text-muted-foreground">
            Ce lien de partage a été révoqué, a expiré, ou n'existe pas.
          </p>
        </div>
      ) : (
        <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground">
          <div className="flex flex-col gap-1">
            <h1 className="truncate text-lg font-semibold">{file.name}</h1>
            <p className="text-sm text-muted-foreground">
              {file.mimeType ?? "Fichier"} · {formatBytes(file.sizeBytes)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="accent">{file.role === "editor" ? "Édition" : "Lecture"}</Badge>
            <span className="text-xs text-muted-foreground">
              Partagé via un lien Workspace — les accès sont journalisés.
            </span>
          </div>

          {file.kind === "file" ? (
            <a href={`/api/drive/shared/${token}`} download>
              <Button className="w-full">Télécharger</Button>
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">
              Les dossiers partagés s'ouvrent depuis l'application après connexion.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
