import { createFileRoute, Link } from "@tanstack/react-router";
import { getDocumentFn, listDocumentVersionsFn, renameDocumentFn } from "@workspace/docs/server";
import { DocumentEditor } from "@workspace/docs/ui";
import { Badge, Button, IconFileText, Input } from "@workspace/ui";
import { type FormEvent, useEffect, useState } from "react";

export const Route = createFileRoute("/_app/doc/$fileId")({ component: DocumentPage });

type Loaded = {
  fileId: string;
  title: string;
  content: unknown;
  currentVersion: number;
  updatedAt: string;
  canEdit: boolean;
  revision: string;
};

function DocumentPage() {
  const { fileId } = Route.useParams();
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [versions, setVersions] = useState<
    { id: string; version: number; createdAt: string }[] | null
  >(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await getDocumentFn({ data: { fileId } });
        if (cancelled) return;
        setDoc(loaded);
        setTitle(loaded.title);
      } catch {
        if (!cancelled) setError("Document introuvable ou accès refusé.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  async function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = title.trim();
    if (!doc || clean.length === 0 || clean === doc.title) {
      setTitle(doc?.title ?? "");
      return;
    }

    setSavingTitle(true);
    try {
      const renamed = await renameDocumentFn({ data: { fileId, title: clean } });
      setDoc({ ...doc, title: renamed.title });
      setTitle(renamed.title);
    } catch {
      setTitle(doc.title);
    } finally {
      setSavingTitle(false);
    }
  }

  async function onLoadVersions() {
    if (versions !== null) {
      setVersions(null);
      setVersionsError(null);
      return;
    }
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      setVersions(await listDocumentVersionsFn({ data: { fileId } }));
    } catch {
      setVersionsError("Impossible de charger l'historique des versions.");
    } finally {
      setVersionsLoading(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Link to="/" className="text-sm font-medium text-primary hover:underline">
          Retour aux documents
        </Link>
      </div>
    );
  }

  if (!doc) {
    return <p className="text-sm text-muted-foreground">Chargement du document…</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col print-flow">
      <header className="flex flex-wrap items-center gap-3 border-b border-border pb-3 print-hide">
        <Link
          to="/"
          className="text-sm text-muted-foreground hover:text-foreground"
          aria-label="Retour aux documents"
        >
          ← Documents
        </Link>

        <form onSubmit={onRename} method="post" className="flex min-w-0 flex-1 items-center gap-2">
          <Input
            aria-label="Titre du document"
            className="h-8 max-w-md border-transparent bg-transparent px-1 text-base font-semibold focus-visible:border-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!doc.canEdit || savingTitle}
            maxLength={255}
          />
        </form>

        {!doc.canEdit ? <Badge variant="outline">Lecture seule</Badge> : null}
        <Badge variant="default">v{doc.currentVersion}</Badge>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            loading={versionsLoading}
            onClick={() => void onLoadVersions()}
          >
            Historique
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            Imprimer
          </Button>
          <a href={`/api/docs/export/${fileId}?format=md`} download>
            <Button variant="outline" size="sm">
              Exporter .md
            </Button>
          </a>
          <a href={`/api/docs/export/${fileId}?format=html`} download>
            <Button variant="outline" size="sm">
              Exporter .html
            </Button>
          </a>
        </div>
      </header>

      {versionsError ? (
        <div className="border-b border-border bg-muted/40 px-3 py-2 print-hide">
          <p role="alert" className="text-xs text-destructive">
            {versionsError}
          </p>
        </div>
      ) : null}

      {versions ? (
        <div className="border-b border-border bg-muted/40 px-3 py-2 print-hide">
          <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Versions
          </p>
          {versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune version enregistrée.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {versions.map((version) => (
                <li key={version.id}>
                  <Badge variant="outline">
                    v{version.version} ·{" "}
                    {new Date(version.createdAt).toLocaleString("fr-FR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col print-surface">
        <DocumentEditor
          fileId={fileId}
          initialRevision={doc.revision}
          initialContent={doc.content}
          canEdit={doc.canEdit}
        />
      </div>

      <p className="flex items-center gap-1 border-t border-border pt-2 text-xs text-muted-foreground print-hide">
        <IconFileText /> « {doc.title} » — fichier du Drive partagé avec les mêmes permissions.
      </p>
    </div>
  );
}
