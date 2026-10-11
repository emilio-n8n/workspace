import { Link, useRouter } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  cn,
  Dialog,
  DOCS_MIME,
  FileIcon,
  IconChevronDown,
  IconFolder,
  IconTrash,
  Input,
  Label,
} from "@workspace/ui";
import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type BreadcrumbItem,
  breadcrumbFn,
  createFolderFn,
  type DriveEntryView,
  entryDetailsFn,
  listDriveFn,
  listRecentFn,
  listSharedFn,
  renameEntryFn,
  trashEntryFn,
} from "../server.ts";
import { ShareDialog } from "./share-dialog.tsx";

type View = "drive" | "recent" | "shared";

type Props = {
  view?: View;
  folderId?: string | null;
  /** Base URL de l'application Docs (navigation inter-apps). */
  docsUrl?: string;
  /** Création d'un document côté application hôtesse (injecté). */
  createDocument?: (parentId: string | null, title: string) => Promise<{ fileId: string }>;
};

type DetailsState = {
  entry: DriveEntryView;
  versions: { id: string; version: number; sizeBytes: number; createdAt: string }[];
};

type TypeFilter = "all" | "folders" | "files";

const ROLE_LABELS: Record<string, string> = {
  viewer: "Lecture",
  commenter: "Commentaire",
  editor: "Édition",
  owner: "Propriétaire",
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

/** Date compacte pour les tableaux (sans l'heure). */
function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

const TABS: { id: string; label: string; to: string }[] = [
  { id: "drive", label: "Mon Drive", to: "/" },
  { id: "recent", label: "Récents", to: "/recent" },
  { id: "shared", label: "Partagés avec moi", to: "/shared" },
  { id: "trash", label: "Corbeille", to: "/trash" },
];

/**
 * Navigateur de fichiers Drive : dossiers, upload (bouton ou glisser-déposer),
 * recherche dans la vue, tri, renommage, corbeille, aperçu des versions et partage.
 */
export function DriveBrowser({ view = "drive", folderId = null, docsUrl, createDocument }: Props) {
  const router = useRouter();

  const [entries, setEntries] = useState<DriveEntryView[] | null>(null);
  const [sharedRoles, setSharedRoles] = useState<Map<string, string>>(new Map());
  const [crumbs, setCrumbs] = useState<BreadcrumbItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortAsc, setSortAsc] = useState(true);

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
      if (view === "drive") {
        const [list, crumb] = await Promise.all([
          listDriveFn({ data: { parentId: folderId } }),
          folderId ? breadcrumbFn({ data: { entryId: folderId } }) : Promise.resolve([]),
        ]);
        setEntries(list);
        setCrumbs(crumb);
        return;
      }

      if (view === "recent") {
        setEntries(await listRecentFn());
        setCrumbs([]);
        return;
      }

      const rows = await listSharedFn();
      setEntries(rows.map((row) => row.entry));
      setSharedRoles(new Map(rows.map((row) => [row.entry.id, row.role])));
      setCrumbs([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de charger le contenu.");
      setEntries([]);
    }
  }, [view, folderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleEntries = useMemo(() => {
    if (!entries) return null;

    let rows = entries;
    if (query.trim().length > 0) {
      const needle = query.trim().toLowerCase();
      rows = rows.filter((entry) => entry.name.toLowerCase().includes(needle));
    }
    if (typeFilter === "folders") rows = rows.filter((entry) => entry.kind === "folder");
    if (typeFilter === "files") rows = rows.filter((entry) => entry.kind === "file");

    if (!sortAsc || query.trim().length > 0) {
      rows = [...rows].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) * (sortAsc ? 1 : -1);
      });
    }

    return rows;
  }, [entries, query, typeFilter, sortAsc]);

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
      window.dispatchEvent(new Event("workspace:storage-changed"));
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
      if (view === "drive") {
        void router.navigate({ to: "/$entryId", params: { entryId: entry.id } });
      } else {
        void router.navigate({ to: "/$entryId", params: { entryId: entry.id } });
      }
      return;
    }
    if (entry.mimeType === DOCS_MIME) {
      if (docsUrl) {
        window.location.assign(`${docsUrl}/doc/${entry.id}`);
        return;
      }
      const loadedDoc = await entryDetailsFn({ data: { entryId: entry.id } });
      setDetails({ entry: loadedDoc.entry, versions: loadedDoc.versions });
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
      if (!createDocument || !docsUrl) return;
      const created = await createDocument(folderId, title);
      setDocDialogOpen(false);
      setDocTitle("");
      window.location.assign(`${docsUrl}/doc/${created.fileId}`);
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
    try {
      await trashEntryFn({ data: { entryId: entry.id } });
      await refresh();
      window.dispatchEvent(new Event("workspace:storage-changed"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Mise à la corbeille impossible.");
    }
  }

  const title =
    view === "recent" ? "Récents" : view === "shared" ? "Partagés avec moi" : "Mon Drive";

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
      {/* Onglets de vues */}
      <nav aria-label="Vues du Drive" className="flex items-center gap-1 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            to={tab.to}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              view === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <header className="flex flex-wrap items-center gap-3">
        {view === "drive" ? (
          <nav aria-label="Fil d'Ariane" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
            <Link to="/" className="font-medium hover:underline">
              Mon Drive
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
                      to="/$entryId"
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
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{title}</h1>
        )}

        {view === "drive" ? (
          <div className="flex flex-wrap items-center gap-2">
            <NewMenu
              onFolder={() => setFolderDialogOpen(true)}
              onDoc={createDocument && docsUrl ? () => setDocDialogOpen(true) : undefined}
              onUpload={() => fileInputRef.current?.click()}
              uploading={uploading}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void onUpload(event.target.files);
              }}
            />
          </div>
        ) : null}
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {/* Recherche locale + filtres */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Rechercher dans cette vue"
          placeholder="Rechercher dans cette vue…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 max-w-xs"
        />
        <select
          aria-label="Filtrer par type"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="all">Tous les types</option>
          <option value="folders">Dossiers</option>
          <option value="files">Fichiers</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {visibleEntries ? `${visibleEntries.length} élément(s)` : ""}
        </span>
      </div>

      {visibleEntries === null ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : visibleEntries.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <IconFolder />
            <p className="font-medium">
              {view === "recent"
                ? "Aucun élément récent"
                : view === "shared"
                  ? "Rien ne vous a été partagé pour le moment"
                  : query.trim().length > 0 || typeFilter !== "all"
                    ? "Aucun résultat pour ces critères"
                    : "Ce dossier est vide"}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {view === "drive"
                ? "Créez un dossier, un document, ou glissez des fichiers ici pour les téléverser."
                : "Les éléments apparaîtront ici automatiquement."}
            </p>
            {view === "drive" ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setFolderDialogOpen(true)}>
                  Nouveau dossier
                </Button>
                <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                  Téléverser un fichier
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="w-full px-4 py-2 font-medium">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => setSortAsc((current) => !current)}
                    title="Trier par nom"
                  >
                    Nom <span aria-hidden>{sortAsc ? "↑" : "↓"}</span>
                  </button>
                </th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">
                  {view === "shared" ? "Droit" : "Propriétaire"}
                </th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Modifié</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Taille</th>
                <th className="px-2 py-2 font-medium sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
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
                      <FileIcon
                        kind={entry.kind}
                        mimeType={entry.mimeType}
                        name={entry.name}
                        className="size-4 shrink-0"
                      />
                      <span className="truncate font-medium">{entry.name}</span>
                      {entry.mimeType === DOCS_MIME ? (
                        <Badge variant="accent" className="hidden sm:inline-flex">
                          Document
                        </Badge>
                      ) : null}
                    </button>
                  </td>
                  <td className="hidden px-4 py-2 text-muted-foreground sm:table-cell">
                    {view === "shared"
                      ? (ROLE_LABELS[sharedRoles.get(entry.id) ?? "viewer"] ?? "Partagé")
                      : entry.isOwner
                        ? "moi"
                        : "Partagé"}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-2 text-muted-foreground md:table-cell">
                    {formatDateShort(entry.updatedAt)}
                  </td>
                  <td className="hidden px-4 py-2 text-muted-foreground sm:table-cell">
                    {entry.kind === "folder" ? "—" : formatBytes(entry.sizeBytes)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <RowMenu
                      entry={entry}
                      showDownload={entry.kind === "file" && entry.mimeType !== DOCS_MIME}
                      onOpen={() => void onOpen(entry)}
                      onRename={() => {
                        setRenameTarget(entry);
                        setRenameValue(entry.name);
                      }}
                      onShare={() => setShareTarget(entry)}
                      onTrash={() => void onTrash(entry)}
                    />
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

      {/* --- Dialogues --------------------------------------------------------- */}

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
              Le document sera créé ici avec les mêmes permissions.
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

/** Menu « Nouveau » : dossier, document ou téléversement. */
function NewMenu({
  onFolder,
  onDoc,
  onUpload,
  uploading,
}: {
  onFolder: () => void;
  onDoc?: () => void;
  onUpload: () => void;
  uploading: boolean;
}) {
  const [open, setOpen] = useState(false);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="relative">
      <Button
        size="sm"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        loading={uploading}
      >
        Nouveau <IconChevronDown className="size-3.5" />
      </Button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Fermer le menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-border bg-card p-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => choose(onFolder)}
            >
              <IconFolder /> Nouveau dossier
            </button>
            {onDoc ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => choose(onDoc)}
              >
                <FileIcon kind="file" mimeType={DOCS_MIME} name="doc" /> Nouveau document
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => choose(onUpload)}
            >
              Téléverser un fichier
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Menu contextuel « ⋮ » d'une ligne. */
function RowMenu({
  entry,
  showDownload,
  onOpen,
  onRename,
  onShare,
  onTrash,
}: {
  entry: DriveEntryView;
  showDownload: boolean;
  onOpen: () => void;
  onRename: () => void;
  onShare: () => void;
  onTrash: () => void;
}) {
  const [open, setOpen] = useState(false);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="relative inline-block text-left">
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions pour « ${entry.name} »`}
        title="Actions"
        onClick={() => setOpen((current) => !current)}
      >
        ⋮
      </Button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Fermer le menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-border bg-card p-1 text-left shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => choose(onOpen)}
            >
              Ouvrir
            </button>
            {showDownload ? (
              <a
                role="menuitem"
                href={`/api/drive/download/${entry.id}`}
                download
                className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                Télécharger
              </a>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => choose(onRename)}
            >
              Renommer
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => choose(onShare)}
            >
              Partager
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-muted"
              onClick={() => choose(onTrash)}
            >
              <IconTrash /> Mettre à la corbeille
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
