import { Link, useRouter } from "@tanstack/react-router";
import { Badge, Button, Card, cn, Dialog, Input, Label } from "@workspace/ui";
import { type DragEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { IconFileText, IconFolder, IconTrash } from "../../components/icons";
import { createDocumentFn } from "../../server/docs";
import {
  type BreadcrumbItem,
  breadcrumbFn,
  createFolderFn,
  type DriveEntryView,
  entryDetailsFn,
  listDriveFn,
  renameEntryFn,
  trashEntryFn,
} from "../../server/drive";
import { ShareDialog } from "./share-dialog";

export const DOCS_MIME = "application/vnd.workspace.docs+json";

type Props = { folderId: string | null };

type DetailsState = {
  entry: DriveEntryView;
  versions: { id: string; version: number; sizeBytes: number; createdAt: string }[];
};

function formatBytes(size: number | null): string {
  if (size === null) return "—";
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Navigateur de fichiers Drive : dossiers, upload (bouton ou glisser-déposer),
 * renommage, corbeille, aperçu des versions et partage.
 */
export function DriveBrowser({ folderId }: Props) {
  const router = useRouter();

  const [entries, setEntries] = useState<DriveEntryView[] | null>(null);
  const [crumbs, setCrumbs] = useState<BreadcrumbItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [creatingDoc, setCreatingDoc] = useState(false);

  const [renameTarget, setRenameTarget] = useState<DriveEntryView | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [shareTarget, setShareTarget] = useState<DriveEntryView | null>(null);
  const [details, setDetails] = useState<DetailsState | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [list, crumb] = await Promise.all([
        listDriveFn({ data: { parentId: folderId } }),
        folderId ? breadcrumbFn({ data: { entryId: folderId } }) : Promise.resolve([]),
      ]);
      setEntries(list);
      setCrumbs(crumb);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de charger ce dossier.");
      setEntries([]);
    }
  }, [folderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onUpload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    setUploading(true);
    setError(null);
    try {
      for (const file of list) {
        const form = new FormData();
        form.append("file", file);
        if (folderId) form.append("parentId", folderId);

        const response = await fetch("/api/drive/upload", { method: "POST", body: form });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message ?? `Échec de l'envoi de « ${file.name} ».`);
        }
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Échec de l'envoi.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    void onUpload(event.dataTransfer.files);
  }

  async function onOpen(entry: DriveEntryView) {
    if (entry.kind === "folder") {
      void router.navigate({ to: "/app/drive/$entryId", params: { entryId: entry.id } });
      return;
    }
    if (entry.mimeType === DOCS_MIME) {
      void router.navigate({ to: "/app/docs/$fileId", params: { fileId: entry.id } });
      return;
    }
    const loaded = await entryDetailsFn({ data: { entryId: entry.id } });
    setDetails({ entry: loaded.entry, versions: loaded.versions });
  }

  async function onCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderName.trim();
    if (name.length === 0) return;

    setCreatingFolder(true);
    setError(null);
    try {
      await createFolderFn({ data: { parentId: folderId, name } });
      setFolderName("");
      setFolderDialogOpen(false);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setCreatingFolder(false);
    }
  }

  async function onCreateDoc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = docTitle.trim();
    if (title.length === 0) return;

    setCreatingDoc(true);
    setError(null);
    try {
      const created = await createDocumentFn({ data: { parentFolderId: folderId, title } });
      setDocDialogOpen(false);
      setDocTitle("");
      void router.navigate({ to: "/app/docs/$fileId", params: { fileId: created.fileId } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création du document impossible.");
    } finally {
      setCreatingDoc(false);
    }
  }

  async function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (name.length === 0) return;

    setRenaming(true);
    try {
      await renameEntryFn({ data: { entryId: renameTarget.id, name } });
      setRenameTarget(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Renommage impossible.");
    } finally {
      setRenaming(false);
    }
  }

  async function onTrash(entry: DriveEntryView) {
    await trashEntryFn({ data: { entryId: entry.id } });
    await refresh();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: la zone de dépôt est une amélioration souris ; le chemin clavier reste le bouton « Téléverser ».
    <div
      className="relative flex flex-col gap-4"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="flex flex-wrap items-center gap-3">
        <nav aria-label="Fil d'Ariane" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          <Link to="/app/drive" className="font-medium hover:underline">
            Drive
          </Link>
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <span key={crumb.id} className="flex min-w-0 items-center gap-1">
                <span className="text-muted-foreground">/</span>
                {isLast ? (
                  <span className="truncate font-medium">{crumb.name}</span>
                ) : (
                  <Link
                    to="/app/drive/$entryId"
                    params={{ entryId: crumb.id }}
                    className="truncate hover:underline"
                  >
                    {crumb.name}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setFolderDialogOpen(true)}>
            <IconFolder /> Nouveau dossier
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDocDialogOpen(true)}>
            <IconFileText /> Nouveau document
          </Button>
          <Button size="sm" loading={uploading} onClick={() => fileInputRef.current?.click()}>
            {uploading ? "Envoi…" : "Téléverser"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void onUpload(event.target.files);
            }}
          />
          <Link
            to="/app/drive/trash"
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Corbeille
          </Link>
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {entries === null ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : entries.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <IconFolder />
            <p className="font-medium">Ce dossier est vide</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Créez un dossier, un document, ou glissez des fichiers ici pour les téléverser.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setFolderDialogOpen(true)}>
                Nouveau dossier
              </Button>
              <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                Téléverser un fichier
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="w-full px-4 py-2 font-medium">Nom</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Taille</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Modifié</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-border/60 last:border-b-0 hover:bg-muted/30"
                >
                  <td className="w-full px-4 py-2">
                    <button
                      type="button"
                      onClick={() => void onOpen(entry)}
                      className="flex w-full min-w-0 items-center gap-2 text-left"
                    >
                      <span className="text-muted-foreground">
                        {entry.kind === "folder" ? <IconFolder /> : <IconFileText />}
                      </span>
                      <span className="truncate font-medium">{entry.name}</span>
                      {entry.mimeType === DOCS_MIME ? (
                        <Badge variant="accent" className="hidden sm:inline-flex">
                          Document
                        </Badge>
                      ) : null}
                    </button>
                  </td>
                  <td className="hidden px-4 py-2 text-muted-foreground sm:table-cell">
                    {entry.kind === "folder" ? "—" : formatBytes(entry.sizeBytes)}
                  </td>
                  <td className="hidden px-4 py-2 text-muted-foreground md:table-cell">
                    {formatDate(entry.updatedAt)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {entry.kind === "file" && entry.mimeType !== DOCS_MIME ? (
                        <a
                          href={`/api/drive/download/${entry.id}`}
                          download
                          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          Télécharger
                        </a>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRenameTarget(entry);
                          setRenameValue(entry.name);
                        }}
                      >
                        Renommer
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShareTarget(entry)}>
                        Partager
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Mettre « ${entry.name} » à la corbeille`}
                        title="Mettre à la corbeille"
                        onClick={() => void onTrash(entry)}
                      >
                        <IconTrash />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dragOver ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-10 flex items-center justify-center",
            "rounded-lg border-2 border-dashed border-primary bg-background/80",
          )}
        >
          <p className="text-sm font-medium text-primary">
            Déposez les fichiers pour les téléverser ici
          </p>
        </div>
      ) : null}

      <Dialog
        open={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        title="Nouveau dossier"
      >
        <form onSubmit={onCreateFolder} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="folder-name">Nom du dossier</Label>
            <Input
              id="folder-name"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="Projets 2026"
              maxLength={255}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setFolderDialogOpen(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              loading={creatingFolder}
              disabled={folderName.trim().length === 0}
            >
              Créer le dossier
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={docDialogOpen} onClose={() => setDocDialogOpen(false)} title="Nouveau document">
        <form onSubmit={onCreateDoc} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="doc-name">Titre du document</Label>
            <Input
              id="doc-name"
              value={docTitle}
              onChange={(event) => setDocTitle(event.target.value)}
              placeholder="Compte rendu de réunion"
              maxLength={255}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Le document sera créé dans ce dossier avec les mêmes permissions.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDocDialogOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={creatingDoc} disabled={docTitle.trim().length === 0}>
              Créer et ouvrir
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title={renameTarget ? `Renommer « ${renameTarget.name} »` : "Renommer"}
      >
        <form onSubmit={onRename} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-name">Nouveau nom</Label>
            <Input
              id="rename-name"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              maxLength={255}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRenameTarget(null)}>
              Annuler
            </Button>
            <Button type="submit" loading={renaming} disabled={renameValue.trim().length === 0}>
              Renommer
            </Button>
          </div>
        </form>
      </Dialog>

      <ShareDialog
        entry={shareTarget}
        open={shareTarget !== null}
        onClose={() => setShareTarget(null)}
      />

      <Dialog
        open={details !== null}
        onClose={() => setDetails(null)}
        title={details ? details.entry.name : "Détails"}
      >
        {details ? (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Type</dt>
              <dd>{details.entry.mimeType ?? "fichier"}</dd>
              <dt className="text-muted-foreground">Taille</dt>
              <dd>{formatBytes(details.entry.sizeBytes)}</dd>
              <dt className="text-muted-foreground">Modifié</dt>
              <dd>{formatDate(details.entry.updatedAt)}</dd>
            </dl>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Versions
              </h3>
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {details.versions.map((version) => (
                  <li key={version.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Badge variant="outline">v{version.version}</Badge>
                    <span className="flex-1 text-muted-foreground">
                      {formatBytes(version.sizeBytes)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(version.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex justify-end gap-2">
              <a href={`/api/drive/download/${details.entry.id}`} download>
                <Button size="sm">Télécharger</Button>
              </a>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShareTarget(details.entry);
                  setDetails(null);
                }}
              >
                Partager
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
