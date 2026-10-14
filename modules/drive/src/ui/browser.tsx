import { Link, useRouter } from "@tanstack/react-router";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  cn,
  Dialog,
  DOCS_MIME,
  FileIcon,
  FORMS_MIME,
  IconFolder,
  Input,
  Label,
  LoadingState,
  SHEETS_MIME,
  SITES_MIME,
  SLIDES_MIME,
  Toasts,
  useToasts,
} from "@workspace/ui";
import {
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
  moveEntriesFn,
  renameEntryFn,
  trashEntriesFn,
  trashEntryFn,
} from "../server.ts";
import { Breadcrumbs } from "./breadcrumbs.tsx";
import { NewMenu, RowMenu } from "./entry-menus.tsx";
import { remainingNameChars, validateEntryName } from "./entry-name.ts";
import { clampCursor, cursorAnnouncement, gridActionForKey, listAnnouncement } from "./grid-nav.ts";
import { isLinkedMime, MAX_BULK_DOWNLOAD } from "./linked-files.ts";
import {
  imagePreviewErrorMessage,
  type PreviewMode,
  previewModeFor,
  previewUrl,
  TEXT_PREVIEW_LIMIT,
  textPreviewErrorMessage,
  truncatedNotice,
} from "./preview.ts";
import {
  deselectId,
  downloadableEntries,
  EMPTY_SELECTION,
  pruneSelection,
  type Selection,
  selectAllIds,
  selectRange,
  toggleSelection,
} from "./selection.ts";
import { MoveDialog, SelectionActionBar } from "./selection-bar.tsx";
import { ShareDialog } from "./share-dialog.tsx";
import {
  enqueueUploads,
  hasKnownProgress,
  markUploaded,
  markUploadFailed,
  markUploading,
  markUploadProgress,
  pendingUploadIds,
  retryLabel,
  type UploadItem,
  uploadPercent,
  uploadPercentLabel,
  uploadSummary,
} from "./upload-queue.ts";
import { SortableColumn, ViewControls, ViewControlsHint } from "./view-controls.tsx";
import {
  DEFAULT_VIEW_PREFS,
  parseViewPrefs,
  rowPadding,
  serializeViewPrefs,
  sortEntries,
  sortSummary,
  VIEW_PREFS_STORAGE_KEY,
  type ViewPrefs,
} from "./view-prefs.ts";

type View = "drive" | "recent" | "shared";

type Props = {
  view?: View;
  folderId?: string | null;
  /** Base URL de l'application Docs (navigation inter-apps). */
  docsUrl?: string;
  /** Base URL de l'application Sheets (navigation inter-apps). */
  sheetsUrl?: string;
  /** Base URL de l'application Slides (navigation inter-apps). */
  slidesUrl?: string;
  /** Base URL de l'application Forms (navigation inter-apps). */
  formsUrl?: string;
  /** Création d'un document côté application hôtesse (injecté). */
  createDocument?: (parentId: string | null, title: string) => Promise<{ fileId: string }>;
  /** Création d'une feuille de calcul côté application hôtesse (injecté). */
  createSpreadsheet?: (parentId: string | null, title: string) => Promise<{ fileId: string }>;
  /** Création d'une présentation côté application hôtesse (injecté). */
  createPresentation?: (parentId: string | null, title: string) => Promise<{ fileId: string }>;
  /** Création d'un formulaire côté application hôtesse (injecté). */
  createForm?: (parentId: string | null, title: string) => Promise<{ fileId: string }>;
};

type DetailsState = {
  entry: DriveEntryView;
  versions: { id: string; version: number; sizeBytes: number; createdAt: string }[];
};

type PreviewState = {
  entry: DriveEntryView;
  mode: PreviewMode;
};

type TextPreviewState =
  | { status: "loading" }
  | { status: "ready"; text: string; truncated: boolean }
  | { status: "error" };

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

/** Libellé du badge des fichiers liés (ouverts par l'application dédiée). */
const LINKED_LABELS: Record<string, string> = {
  [DOCS_MIME]: "Document",
  [SHEETS_MIME]: "Feuille",
  [SLIDES_MIME]: "Présentation",
  [FORMS_MIME]: "Formulaire",
};

/** Types connus → libellés français (badges et dialogue de détails). */
const MIME_LABELS: Record<string, string> = { ...LINKED_LABELS, [SITES_MIME]: "Site" };

/**
 * Lit le corps d'une réponse en s'arrêtant au plafond de l'aperçu (sans charger
 * un fichier entier) ; renvoie le texte UTF-8 décodé et le drapeau de troncature.
 */
async function readTextPreview(response: Response): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    const truncated = text.length > TEXT_PREVIEW_LIMIT;
    return { text: truncated ? text.slice(0, TEXT_PREVIEW_LIMIT) : text, truncated };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let read = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    const remaining = TEXT_PREVIEW_LIMIT - read;
    if (value.byteLength > remaining) {
      text += decoder.decode(value.subarray(0, remaining), { stream: true });
      truncated = true;
      break;
    }
    read += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  // Coupe la connexion dès que la suite du fichier n'est plus utile.
  if (truncated) await reader.cancel().catch(() => undefined);
  return { text, truncated };
}

/** Corps d'erreur de l'API d'upload : message français, sinon repli nommé. */
function uploadErrorMessage(responseText: string, fileName: string): string {
  try {
    const payload = JSON.parse(responseText) as { message?: unknown };
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message;
    }
  } catch {
    // réponse non JSON : on garde le message générique.
  }
  return `Échec de l'envoi de « ${fileName} ».`;
}

/**
 * Téléverse un fichier en rapportant la progression réelle de l'envoi.
 *
 * `XMLHttpRequest` est utilisé volontairement : c'est le seul moyen aujourd'hui
 * d'obtenir `upload.onprogress` de façon fiable (`fetch` n'expose pas la
 * progression montante). La progression rapportée vient donc de l'octet
 * réellement transmis, jamais d'une animation simulée.
 */
function uploadFileWithProgress(
  file: File,
  parentId: string | null,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (parentId) form.append("parentId", parentId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/drive/upload");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      reject(new Error(uploadErrorMessage(xhr.responseText, file.name)));
    };
    xhr.onerror = () => {
      reject(new Error(`Échec de l'envoi de « ${file.name} » : connexion interrompue.`));
    };
    xhr.onabort = () => {
      reject(new Error(`Envoi de « ${file.name} » interrompu.`));
    };

    xhr.send(form);
  });
}

type CreationKind = "doc" | "sheet" | "slide" | "form";

const CREATION: Record<
  CreationKind,
  { dialogTitle: string; fieldLabel: string; placeholder: string; errorMessage: string }
> = {
  doc: {
    dialogTitle: "Nouveau document",
    fieldLabel: "Titre du document",
    placeholder: "Compte rendu de réunion",
    errorMessage: "Création du document impossible.",
  },
  sheet: {
    dialogTitle: "Nouvelle feuille de calcul",
    fieldLabel: "Titre de la feuille",
    placeholder: "Budget 2026",
    errorMessage: "Création de la feuille impossible.",
  },
  slide: {
    dialogTitle: "Nouvelle présentation",
    fieldLabel: "Titre de la présentation",
    placeholder: "Présentation client",
    errorMessage: "Création de la présentation impossible.",
  },
  form: {
    dialogTitle: "Nouveau formulaire",
    fieldLabel: "Titre du formulaire",
    placeholder: "Enquête de satisfaction",
    errorMessage: "Création du formulaire impossible.",
  },
};

const TABS: { id: string; label: string; to: string }[] = [
  { id: "drive", label: "Mon Drive", to: "/" },
  { id: "recent", label: "Récents", to: "/recent" },
  { id: "shared", label: "Partagés avec moi", to: "/shared" },
  { id: "trash", label: "Corbeille", to: "/trash" },
];

/** Vrai si la frappe au clavier se produit dans un champ de saisie. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.getAttribute("role") === "textbox"
  );
}

/** Vrai si un dialogue modal de l'interface est ouvert (il gère Échap lui-même). */
function isModalOpen(): boolean {
  return typeof document === "undefined" || document.querySelector("dialog[open]") !== null;
}

/**
 * Préférences d'affichage persistées dans le stockage local : lecture au montage
 * (une valeur illisible retombe sur les défauts), écriture à chaque changement.
 * Le stockage peut être indisponible — navigation privée, quota atteint : la
 * préférence s'applique alors sans être retenue.
 */
function useViewPrefs(): [ViewPrefs, (next: ViewPrefs) => void] {
  const [prefs, setPrefs] = useState<ViewPrefs>(DEFAULT_VIEW_PREFS);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(VIEW_PREFS_STORAGE_KEY);
    } catch {
      stored = null;
    }
    const parsed = parseViewPrefs(stored);
    setPrefs(parsed);
    try {
      window.localStorage.setItem(VIEW_PREFS_STORAGE_KEY, serializeViewPrefs(parsed));
    } catch {
      // stockage indisponible : la préférence reste valable pour la session.
    }
  }, []);

  const update = useCallback((next: ViewPrefs) => {
    setPrefs(next);
    try {
      window.localStorage.setItem(VIEW_PREFS_STORAGE_KEY, serializeViewPrefs(next));
    } catch {
      // idem : pas de persistance, mais pas d'erreur affichée à l'utilisateur.
    }
  }, []);

  return [prefs, update];
}

/**
 * Navigateur de fichiers Drive : dossiers, upload (bouton ou glisser-déposer),
 * recherche dans la vue, tri et densité persistés, sélection multiple avec
 * barre d'actions, renommage, corbeille, aperçu des versions et partage.
 */
export function DriveBrowser({
  view = "drive",
  folderId = null,
  docsUrl,
  sheetsUrl,
  slidesUrl,
  formsUrl,
  createDocument,
  createSpreadsheet,
  createPresentation,
  createForm,
}: Props) {
  const router = useRouter();
  const { toasts, push, dismiss } = useToasts();

  const [entries, setEntries] = useState<DriveEntryView[] | null>(null);
  const [sharedRoles, setSharedRoles] = useState<Map<string, string>>(new Map());
  const [crumbs, setCrumbs] = useState<BreadcrumbItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  // Compte des entrées de glisser-déposer : `dragleave` se déclenche aussi en
  // survolant un enfant, un booléen ferait clignoter la zone de dépôt.
  const dragDepthRef = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [prefs, setPrefs] = useViewPrefs();

  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Création de dossier inline : la feuille de saisie s'insère dans la liste.
  const [inlineNew, setInlineNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNameError, setNewNameError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  const [createKind, setCreateKind] = useState<CreationKind | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [creatingFile, setCreatingFile] = useState(false);

  const [renameTarget, setRenameTarget] = useState<DriveEntryView | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [shareTarget, setShareTarget] = useState<DriveEntryView | null>(null);
  const [details, setDetails] = useState<DetailsState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewText, setPreviewText] = useState<TextPreviewState>({ status: "loading" });
  // Chargement des images : distinct du texte, l'image se charge via <img>.
  const [previewImage, setPreviewImage] = useState<"loading" | "ready" | "error">("loading");

  // Curseur de la navigation clavier : index de la ligne focalisée.
  const [cursor, setCursor] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  /** Pose le focus seulement quand la navigation vient du clavier. */
  const shouldFocusRowRef = useRef(false);

  // Fichiers en cours d'envoi, indexés par la clé utilisée dans la file.
  const uploadFilesRef = useRef(new Map<string, File>());
  const uploadIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoadError(null);
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
      setLoadError(caught instanceof Error ? caught.message : "Impossible de charger le contenu.");
      setEntries([]);
    }
  }, [view, folderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Aperçu texte : charge le contenu en ligne à l'ouverture et annule la requête
  // à la fermeture du dialogue (ou au passage à un autre fichier).
  useEffect(() => {
    if (preview?.mode !== "text") return;
    const controller = new AbortController();
    setPreviewText({ status: "loading" });

    void (async () => {
      try {
        const response = await fetch(previewUrl(preview.entry.id), { signal: controller.signal });
        if (!response.ok) throw new Error(`Aperçu indisponible (${response.status}).`);
        const { text, truncated } = await readTextPreview(response);
        setPreviewText({ status: "ready", text, truncated });
      } catch {
        if (!controller.signal.aborted) setPreviewText({ status: "error" });
      }
    })();

    return () => controller.abort();
  }, [preview]);

  // Image : repart de l'état « chargement » à chaque ouverture ; le <img>
  // signale ensuite son sort via onLoad/onError (jamais un succès optimiste).
  useEffect(() => {
    if (preview?.mode === "image") setPreviewImage("loading");
  }, [preview]);

  const visibleEntries = useMemo(() => {
    if (!entries) return null;

    let rows = entries;
    if (query.trim().length > 0) {
      const needle = query.trim().toLowerCase();
      rows = rows.filter((entry) => entry.name.toLowerCase().includes(needle));
    }
    if (typeFilter === "folders") rows = rows.filter((entry) => entry.kind === "folder");
    if (typeFilter === "files") rows = rows.filter((entry) => entry.kind === "file");

    // Le tri est toujours appliqué : un en-tête ne peut pas mentir sur l'ordre.
    return sortEntries(rows, prefs);
  }, [entries, query, typeFilter, prefs]);

  const orderedIds = useMemo(
    () => (visibleEntries ?? []).map((entry) => entry.id),
    [visibleEntries],
  );

  const selectedEntries = useMemo(
    () => (visibleEntries ?? []).filter((entry) => selection.ids.has(entry.id)),
    [visibleEntries, selection.ids],
  );

  // Une ligne qui disparaît (filtre, suppression, déplacement) ne reste pas
  // sélectionnée : la barre d'actions ne doit jamais agir sur un fantôme.
  useEffect(() => {
    if (visibleEntries === null || selection.ids.size === 0) return;
    const pruned = pruneSelection(selection.ids, orderedIds);
    if (pruned.size === selection.ids.size) return;
    setSelection((current) => ({ ...current, ids: pruned }));
  }, [visibleEntries, orderedIds, selection.ids]);

  const clearSelection = useCallback(() => setSelection(EMPTY_SELECTION), []);

  // Raccourcis de la sélection : Ctrl/⌘ + A tout sélectionner, Échap tout annuler.
  // Ignorés pendant la saisie pour ne pas casser le champ de recherche.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelection({ ids: selectAllIds(orderedIds), anchorId: null });
        return;
      }
      if (event.key === "Escape" && selection.ids.size > 0) {
        // Un dialogue modal est ouvert : Échap lui appartient, il ne doit pas
        // aussi vider la sélection en arrière-plan.
        if (!isModalOpen()) clearSelection();
        return;
      }
      // Suppr : mise à la corbeille de la sélection, toujours derrière la
      // confirmation (jamais de geste destructeur sous un seul doigt).
      if (event.key === "Delete" && view === "drive" && selection.ids.size > 0 && !isModalOpen()) {
        event.preventDefault();
        setDeleteOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [orderedIds, selection.ids.size, clearSelection, view]);

  /** Enregistre les fichiers reçus dans la file, avec une clé locale stable. */
  function stashUploads(files: readonly File[]): UploadItem[] {
    return files.map((file) => {
      uploadIdRef.current += 1;
      const id = `up-${uploadIdRef.current}`;
      uploadFilesRef.current.set(id, file);
      return { id, name: file.name, status: "pending", size: file.size };
    });
  }

  /**
   * Envoie les fichiers demandés les uns après les autres : chaque fichier a
   * son propre sort dans la file, un échec ne coupe pas les suivants et se
   * relance individuellement.
   */
  async function runUploads(ids: readonly string[]) {
    if (ids.length === 0) return;
    setError(null);
    setUploads((current) => markUploading(current, ids));

    for (const id of ids) {
      const file = uploadFilesRef.current.get(id);
      if (!file) continue;

      try {
        await uploadFileWithProgress(file, folderId, (fraction) => {
          setUploads((current) => markUploadProgress(current, id, fraction));
        });
        setUploads((current) => markUploaded(current, id));
      } catch (caught) {
        setUploads((current) =>
          markUploadFailed(
            current,
            id,
            caught instanceof Error ? caught.message : `Échec de l'envoi de « ${file.name} ».`,
          ),
        );
      }
    }

    await refresh();
    window.dispatchEvent(new Event("workspace:storage-changed"));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onUpload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    const queued = stashUploads(list);
    setUploads((current) => enqueueUploads(current, queued));
    void runUploads(queued.map((item) => item.id));
  }

  /** Reprend les fichiers en attente ou en échec. */
  function onRetryUploads() {
    void runUploads(pendingUploadIds(uploads));
  }

  function onDragEnter() {
    dragDepthRef.current += 1;
    setDragOver(true);
  }

  function onDragLeave() {
    dragDepthRef.current = Math.max(dragDepthRef.current - 1, 0);
    if (dragDepthRef.current === 0) setDragOver(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);
    onUpload(event.dataTransfer.files);
  }

  async function onOpen(entry: DriveEntryView) {
    if (entry.kind === "folder") {
      void router.navigate({ to: "/$entryId", params: { entryId: entry.id } });
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
    if (entry.mimeType === SHEETS_MIME && sheetsUrl) {
      window.location.assign(`${sheetsUrl}/sheet/${entry.id}`);
      return;
    }
    if (entry.mimeType === SLIDES_MIME && slidesUrl) {
      window.location.assign(`${slidesUrl}/slide/${entry.id}`);
      return;
    }
    if (entry.mimeType === FORMS_MIME && formsUrl) {
      window.location.assign(`${formsUrl}/form/${entry.id}`);
      return;
    }
    // Visionneuse intégrée pour les fichiers standard (image, PDF, texte) ;
    // les autres types gardent le dialogue de détails.
    const mode = previewModeFor(entry.mimeType);
    if (mode) {
      if (mode === "text") setPreviewText({ status: "loading" });
      setPreview({ entry, mode });
      return;
    }
    const loaded = await entryDetailsFn({ data: { entryId: entry.id } });
    setDetails({ entry: loaded.entry, versions: loaded.versions });
  }

  /** Ouvre la feuille de création inline, focus compris. */
  function startInlineCreate() {
    setNewName("");
    setNewNameError(null);
    setInlineNew(true);
    // Le focus est posé après la peinture, quand le champ existe vraiment.
    requestAnimationFrame(() => inlineInputRef.current?.focus());
  }

  function cancelInlineCreate() {
    setInlineNew(false);
    setNewName("");
    setNewNameError(null);
    // Le champ disparaît : rendre le focus à la liste pour que le clavier ne
    // se retrouve pas dans le vide.
    requestAnimationFrame(() => rowRefs.current.get(0)?.focus());
  }

  /**
   * Validation immédiate : le message apparaît à la frappe et la soumission est
   * bloquée tant que le nom n'est pas acceptable. Le serveur reste l'autorité.
   */
  function onNewNameChange(value: string) {
    setNewName(value);
    setNewNameError(value.trim().length === 0 ? null : validateEntryName(value));
  }

  async function onCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    const problem = validateEntryName(name);
    setNewNameError(problem);
    if (problem) {
      inlineInputRef.current?.focus();
      return;
    }

    setCreatingFolder(true);
    setError(null);
    try {
      await createFolderFn({ data: { parentId: folderId, name } });
      cancelInlineCreate();
      await refresh();
    } catch (caught) {
      // Conflit de nom surtout : le message du service est déjà explicite.
      setError(caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setCreatingFolder(false);
    }
  }

  async function onCreateFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = createTitle.trim();
    if (title.length === 0 || createKind === null) return;

    setCreatingFile(true);
    setError(null);
    try {
      if (createKind === "doc" && createDocument && docsUrl) {
        const created = await createDocument(folderId, title);
        setCreateKind(null);
        setCreateTitle("");
        window.location.assign(`${docsUrl}/doc/${created.fileId}`);
        return;
      }
      if (createKind === "sheet" && createSpreadsheet && sheetsUrl) {
        const created = await createSpreadsheet(folderId, title);
        setCreateKind(null);
        setCreateTitle("");
        window.location.assign(`${sheetsUrl}/sheet/${created.fileId}`);
        return;
      }
      if (createKind === "slide" && createPresentation && slidesUrl) {
        const created = await createPresentation(folderId, title);
        setCreateKind(null);
        setCreateTitle("");
        window.location.assign(`${slidesUrl}/slide/${created.fileId}`);
        return;
      }
      if (createKind === "form" && createForm && formsUrl) {
        const created = await createForm(folderId, title);
        setCreateKind(null);
        setCreateTitle("");
        window.location.assign(`${formsUrl}/form/${created.fileId}`);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : createKind
            ? CREATION[createKind].errorMessage
            : "Création impossible.",
      );
    } finally {
      setCreatingFile(false);
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

  /** Nombre accordé en français, pour les comptes rendus d'actions groupées. */
  function counted(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function onDownloadSelected() {
    const files = downloadableEntries(selectedEntries);
    // Les navigateurs ignorent les téléchargements en rafale : on les espace
    // légèrement, et on borne le lot pour ne pas saturer l'onglet.
    const ids = files.slice(0, MAX_BULK_DOWNLOAD).map((entry) => entry.id);
    ids.forEach((id, index) => {
      window.setTimeout(() => {
        const link = document.createElement("a");
        link.href = `/api/drive/download/${id}`;
        link.download = "";
        document.body.append(link);
        link.click();
        link.remove();
      }, index * 150);
    });

    const skipped = files.length - ids.length;
    push(
      "success",
      skipped > 0
        ? `${counted(ids.length, "téléchargement lancé", "téléchargements lancés")} — ${skipped} fichier(s) au-delà de la limite de ${MAX_BULK_DOWNLOAD} ignoré(s).`
        : `${counted(ids.length, "téléchargement lancé", "téléchargements lancés")}.`,
    );
  }

  async function onMoveSelected(targetParentId: string | null) {
    const ids = [...selection.ids];
    if (ids.length === 0) return;

    setBulkBusy(true);
    try {
      const result = await moveEntriesFn({ data: { entryIds: ids, targetParentId } });
      await refresh();
      window.dispatchEvent(new Event("workspace:storage-changed"));
      clearSelection();
      setMoveOpen(false);
      push(
        result.failures.length === 0 ? "success" : "danger",
        result.failures.length === 0
          ? `${counted(result.moved.length, "élément déplacé", "éléments déplacés")}.`
          : `${counted(result.moved.length, "élément déplacé", "éléments déplacés")} et ${counted(result.failures.length, "échec", "échecs")} : ${result.failures[0]?.message ?? "erreur inconnue"}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Déplacement impossible.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function onDeleteSelected() {
    const ids = [...selection.ids];
    if (ids.length === 0) return;

    setBulkBusy(true);
    try {
      const result = await trashEntriesFn({ data: { entryIds: ids } });
      await refresh();
      window.dispatchEvent(new Event("workspace:storage-changed"));
      clearSelection();
      setDeleteOpen(false);
      push(
        result.failures.length === 0 ? "success" : "danger",
        result.failures.length === 0
          ? `${counted(result.trashed.length, "élément mis à la corbeille", "éléments mis à la corbeille")}.`
          : `${counted(result.failures.length, "Élément non supprimé", "Éléments non supprimés")} : ${result.failures[0]?.message ?? "erreur inconnue"}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * Clic sur une ligne, à la façon d'un gestionnaire de fichiers :
   * Maj + clic sélectionne la plage depuis l'ancrage, Ctrl/⌘ + clic bascule
   * l'élément sans toucher au reste, un clic sur une ligne déjà sélectionnée la
   * retire seule, un clic sur une ligne non sélectionnée la prend seule.
   */
  function onRowClick(event: ReactMouseEvent<HTMLTableRowElement>, entry: DriveEntryView) {
    if (event.shiftKey) {
      setSelection((current) => ({
        ids: selectRange(current.anchorId, entry.id, orderedIds),
        anchorId: current.anchorId ?? entry.id,
      }));
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      setSelection((current) => ({
        ids: toggleSelection(current.ids, entry.id),
        anchorId: entry.id,
      }));
      return;
    }
    setSelection((current) =>
      current.ids.has(entry.id)
        ? { ids: deselectId(current.ids, entry.id), anchorId: entry.id }
        : { ids: new Set([entry.id]), anchorId: entry.id },
    );
  }

  const title =
    view === "recent" ? "Récents" : view === "shared" ? "Partagés avec moi" : "Mon Drive";

  const allSelected = orderedIds.length > 0 && selection.ids.size === orderedIds.length;
  const someSelected = selection.ids.size > 0 && !allSelected;
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const node = selectAllRef.current;
    if (node) node.indeterminate = someSelected;
  }, [someSelected]);

  // Dossier affiché : son nom sert à nommer la destination du dépôt et le
  // dossier atteint par la flèche gauche.
  const currentFolderName = crumbs.length > 0 ? crumbs[crumbs.length - 1]?.name : undefined;
  const parentCrumb = crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined;
  const parentNavigation =
    parentCrumb === undefined
      ? ({ to: "/" } as const)
      : ({ to: "/$entryId", params: { entryId: parentCrumb.id } } as const);

  const uploadActive = pendingUploadIds(uploads).length > 0;
  const uploadFailed = uploads.filter((item) => item.status === "error").length;

  // Cible du curseur clavier, format attendu par les annonces.
  const cursorTarget =
    visibleEntries && cursor !== null
      ? (() => {
          const entry = visibleEntries[cursor];
          return entry
            ? { name: entry.name, kind: entry.kind, selected: selection.ids.has(entry.id) }
            : null;
        })()
      : null;

  // Le curseur suit la liste : une ligne qui disparaît (filtre, suppression,
  // déplacement) ne peut pas rester la ligne focalisée.
  useEffect(() => {
    setCursor((current) => {
      const next = clampCursor(current, orderedIds.length);
      return next === current ? current : next;
    });
  }, [orderedIds.length]);

  // Pose le focus sur la ligne visée, mais seulement après une action clavier :
  // un rafraîchissement de la liste ne doit pas voler le focus.
  useEffect(() => {
    if (visibleEntries === null) return;
    if (cursor === null || !shouldFocusRowRef.current) return;
    shouldFocusRowRef.current = false;
    rowRefs.current.get(cursor)?.focus();
  }, [cursor, visibleEntries]);

  /**
   * Navigation clavier de la grille. Les touches n'appartiennent qu'à la ligne
   * focalisée : si le focus est dans un contrôle (case, bouton, champ), c'est
   * ce contrôle qui les traite.
   */
  function onRowKeyDown(
    event: ReactKeyboardEvent<HTMLTableRowElement>,
    entry: DriveEntryView,
    index: number,
  ) {
    if (event.target !== event.currentTarget) return;
    const action = gridActionForKey(event.key, index, visibleEntries?.length ?? 0);
    if (action === null) return;

    event.preventDefault();
    switch (action.kind) {
      case "move":
        if (action.index !== index) shouldFocusRowRef.current = true;
        setCursor(action.index);
        return;
      case "open":
        void onOpen(entry);
        return;
      case "toggle":
        setSelection((current) => ({
          ids: toggleSelection(current.ids, entry.id),
          anchorId: entry.id,
        }));
        return;
      case "parent":
        if (view === "drive" && folderId !== null) {
          void router.navigate(parentNavigation);
        }
        return;
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: la zone de dépôt est une amélioration souris ; le chemin clavier reste le bouton « Téléverser ».
    <div
      className="relative flex flex-col gap-4"
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        // Sans `preventDefault`, le navigateur refuse le dépôt.
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={onDragLeave}
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
          <Breadcrumbs crumbs={crumbs} />
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{title}</h1>
        )}

        {view === "drive" ? (
          <div className="flex flex-wrap items-center gap-2">
            <NewMenu
              onFolder={startInlineCreate}
              onDoc={createDocument && docsUrl ? () => setCreateKind("doc") : undefined}
              onSheet={createSpreadsheet && sheetsUrl ? () => setCreateKind("sheet") : undefined}
              onSlide={createPresentation && slidesUrl ? () => setCreateKind("slide") : undefined}
              onForm={createForm && formsUrl ? () => setCreateKind("form") : undefined}
              onUpload={() => fileInputRef.current?.click()}
              uploading={uploadActive}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) onUpload(event.target.files);
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

      {/* File de téléversement : un sort par fichier, reprise individuelle. */}
      {uploads.length > 0 ? (
        <section
          aria-label="Téléversements en cours"
          className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p aria-live="polite" className="text-sm font-medium">
              {uploadSummary(uploads)}
            </p>
            {uploadFailed > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onRetryUploads}
                disabled={uploadActive || bulkBusy}
              >
                {retryLabel(uploadFailed)}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={uploadActive}
              onClick={() => {
                uploadFilesRef.current.clear();
                setUploads([]);
              }}
            >
              Effacer la liste
            </Button>
          </div>
          <ul className="flex flex-col divide-y divide-border/60 text-sm">
            {uploads.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 py-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "w-24 shrink-0 text-xs",
                      item.status === "error" ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {item.status === "done"
                      ? "Envoyé"
                      : item.status === "error"
                        ? "Échec"
                        : item.status === "uploading"
                          ? "Envoi…"
                          : "En attente"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {item.status === "uploading" ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {uploadPercentLabel(item)}
                    </span>
                  ) : null}
                  {item.status === "error" ? (
                    <>
                      <span className="text-xs text-destructive">{item.message}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={uploadActive}
                        onClick={() => onRetryUploads()}
                        aria-label={`Réessayer l'envoi de « ${item.name} »`}
                      >
                        Réessayer
                      </Button>
                    </>
                  ) : null}
                </div>
                {/* Progression réelle, alimentée par les événements d'envoi. */}
                {hasKnownProgress(item) ? (
                  <progress
                    value={uploadPercent(item)}
                    max={100}
                    aria-label={`Progression de l'envoi de « ${item.name} » : ${uploadPercentLabel(item)}`}
                    className="h-1.5 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {selection.ids.size > 0 ? (
        <SelectionActionBar
          count={selection.ids.size}
          downloadCount={downloadableEntries(selectedEntries).length}
          busy={bulkBusy}
          onClear={clearSelection}
          onDownload={onDownloadSelected}
          onMove={() => setMoveOpen(true)}
          onDelete={() => setDeleteOpen(true)}
        />
      ) : null}

      {/* Recherche locale + filtres + réglages d'affichage */}
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
        <ViewControls prefs={prefs} onChange={setPrefs} />
        <span className="ml-auto text-xs text-muted-foreground">
          {visibleEntries ? counted(visibleEntries.length, "élément", "éléments") : ""}
        </span>
      </div>

      <ViewControlsHint prefs={prefs} />

      {loadError ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p role="alert" className="font-medium text-destructive">
              {loadError}
            </p>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              Réessayer
            </Button>
          </div>
        </Card>
      ) : visibleEntries === null ? (
        <LoadingState label="Chargement du Drive…" />
      ) : visibleEntries.length === 0 && !inlineNew ? (
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
                <Button size="sm" variant="outline" onClick={startInlineCreate}>
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
        <div id="drive-list" className="rounded-xl border border-border">
          <div className="overflow-x-auto">
            {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: rôle « grid » du motif ARIA, posé sur le tableau natif pour que les lecteurs d'écran annoncent une grille navigable. */}
            <table role="grid" aria-multiselectable="true" className="w-full text-sm">
              <caption className="sr-only">
                {listAnnouncement(visibleEntries.length, sortSummary(prefs))} Utilisez les flèches
                pour parcourir la liste, Entrée pour ouvrir un élément, Espace pour le sélectionner,
                Suppr pour le mettre à la corbeille.
              </caption>
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="w-9 px-2 py-2 font-medium">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={allSelected}
                      onChange={() =>
                        setSelection(
                          allSelected
                            ? EMPTY_SELECTION
                            : { ids: selectAllIds(orderedIds), anchorId: null },
                        )
                      }
                      aria-label={
                        allSelected ? "Tout désélectionner" : "Tout sélectionner dans cette vue"
                      }
                      title={allSelected ? "Tout désélectionner" : "Tout sélectionner"}
                    />
                  </th>
                  <SortableColumn
                    column="name"
                    prefs={prefs}
                    onChange={setPrefs}
                    label="Nom"
                    className="w-full"
                  >
                    Nom
                  </SortableColumn>
                  <th className="hidden px-4 py-2 font-medium sm:table-cell">
                    {view === "shared" ? "Droit" : "Propriétaire"}
                  </th>
                  <SortableColumn
                    column="date"
                    prefs={prefs}
                    onChange={setPrefs}
                    label="Date de modification"
                    className="hidden whitespace-nowrap md:table-cell"
                  >
                    Modifié
                  </SortableColumn>
                  <SortableColumn
                    column="size"
                    prefs={prefs}
                    onChange={setPrefs}
                    label="Taille"
                    className="hidden px-4 py-2 font-medium sm:table-cell"
                  >
                    Taille
                  </SortableColumn>
                  <th className="px-2 py-2 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {/* Création inline : une feuille de saisie en tête de liste. */}
                {inlineNew ? (
                  <tr className="border-b border-border bg-muted/20">
                    <td className="w-9 px-2 align-middle text-muted-foreground">
                      <IconFolder />
                    </td>
                    <td className="px-4 py-2" colSpan={5}>
                      <form onSubmit={onCreateFolder} className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Label htmlFor="inline-folder-name" className="sr-only">
                            Nom du nouveau dossier
                          </Label>
                          <Input
                            id="inline-folder-name"
                            ref={inlineInputRef}
                            value={newName}
                            onChange={(event) => onNewNameChange(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelInlineCreate();
                              }
                            }}
                            placeholder="Nom du dossier"
                            maxLength={255}
                            autoFocus
                            aria-invalid={newNameError !== null}
                            aria-describedby={
                              newNameError ? "inline-folder-error" : "inline-folder-hint"
                            }
                            className="h-8 max-w-xs"
                          />
                          <Button
                            type="submit"
                            size="sm"
                            loading={creatingFolder}
                            disabled={newName.trim().length === 0}
                          >
                            Créer
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={cancelInlineCreate}
                          >
                            Annuler
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {`${remainingNameChars(newName)} caractère(s) restant(s)`}
                          </span>
                        </div>
                        {newNameError ? (
                          <p
                            id="inline-folder-error"
                            role="alert"
                            className="text-xs text-destructive"
                          >
                            {newNameError}
                          </p>
                        ) : (
                          <p id="inline-folder-hint" className="text-xs text-muted-foreground">
                            Entrée pour créer, Échap pour annuler.
                          </p>
                        )}
                      </form>
                    </td>
                  </tr>
                ) : null}

                {visibleEntries.map((entry, index) => {
                  const selected = selection.ids.has(entry.id);
                  const isCursor = cursor === index;
                  return (
                    <tr
                      key={entry.id}
                      ref={(node) => {
                        if (node) rowRefs.current.set(index, node);
                        else rowRefs.current.delete(index);
                      }}
                      aria-selected={selected}
                      // Onglet mobile : une seule ligne est atteignable à la
                      // fois (la première tant que le curseur n'est pas posé),
                      // les flèches font le reste.
                      tabIndex={isCursor || (cursor === null && index === 0) ? 0 : -1}
                      className={cn(
                        "border-b border-border/60 last:border-b-0 hover:bg-muted/30",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        selected ? "bg-accent/60" : undefined,
                        isCursor && !selected ? "bg-muted/50" : undefined,
                      )}
                      onFocus={() => setCursor(index)}
                      onClick={(event) => onRowClick(event, entry)}
                      onDoubleClick={() => void onOpen(entry)}
                      onKeyDown={(event) => onRowKeyDown(event, entry, index)}
                      title="Cliquer pour sélectionner, double-cliquer pour ouvrir"
                    >
                      <td className="w-9 px-2 align-middle">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={selected}
                          onChange={() =>
                            setSelection((current) => ({
                              ids: toggleSelection(current.ids, entry.id),
                              anchorId: entry.id,
                            }))
                          }
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Sélectionner « ${entry.name} »`}
                        />
                      </td>
                      <td className={cn("w-full px-4", rowPadding(prefs.density))}>
                        <button
                          type="button"
                          onClick={(event) => {
                            // Le nom reste le geste « ouvrir » : il ne doit pas
                            // déclencher la sélection de la ligne.
                            event.stopPropagation();
                            void onOpen(entry);
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                          className="flex w-full min-w-0 items-center gap-2 text-left"
                        >
                          <FileIcon
                            kind={entry.kind}
                            mimeType={entry.mimeType}
                            name={entry.name}
                            className="size-4 shrink-0"
                          />
                          <span className="truncate font-medium">{entry.name}</span>
                          {entry.mimeType && LINKED_LABELS[entry.mimeType] ? (
                            <Badge variant="accent" className="hidden sm:inline-flex">
                              {LINKED_LABELS[entry.mimeType]}
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
                      <td className="relative px-2 py-2 text-right">
                        <RowMenu
                          entry={entry}
                          showDownload={entry.kind === "file" && !isLinkedMime(entry.mimeType)}
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
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Cliquez sur une ligne pour la sélectionner · Maj + clic pour une plage · Ctrl/⌘ + A pour
            tout sélectionner · Échap pour annuler. Au clavier : les flèches parcourent la liste,
            Entrée ouvre l'élément, la flèche gauche remonte au dossier parent, Espace sélectionne,
            Suppr met à la corbeille.
          </p>
        </div>
      )}

      {/* Position du curseur clavier, annoncée à chaque déplacement. La
          composition de la liste (nombre, tri) est portée par la légende du
          tableau : lue à l'entrée dans la grille, sans bavardage à la frappe. */}
      <p aria-live="polite" className="sr-only">
        {cursorAnnouncement(cursorTarget, cursor ?? 0, visibleEntries?.length ?? 0)}
      </p>

      {dragOver ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-10 flex items-center justify-center",
            "rounded-lg border-2 border-dashed border-primary bg-background/80",
          )}
        >
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-sm font-medium text-primary">
              {currentFolderName
                ? `Déposez les fichiers pour les téléverser dans « ${currentFolderName} »`
                : "Déposez les fichiers pour les téléverser dans Mon Drive"}
            </p>
            <p className="text-xs text-muted-foreground">
              Chaque fichier est envoyé séparément ; un échec se relance individuellement.
            </p>
          </div>
        </div>
      ) : null}

      {/* --- Dialogues --------------------------------------------------------- */}

      <Dialog
        open={createKind !== null}
        onClose={() => setCreateKind(null)}
        title={createKind ? CREATION[createKind].dialogTitle : "Nouveau"}
      >
        <form onSubmit={onCreateFile} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-name">
              {createKind ? CREATION[createKind].fieldLabel : "Titre"}
            </Label>
            <Input
              id="create-name"
              value={createTitle}
              onChange={(event) => setCreateTitle(event.target.value)}
              placeholder={createKind ? CREATION[createKind].placeholder : ""}
              maxLength={255}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Le fichier sera créé ici avec les mêmes permissions.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreateKind(null)}>
              Annuler
            </Button>
            <Button type="submit" loading={creatingFile} disabled={createTitle.trim().length === 0}>
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
              <dd>
                {details.entry.mimeType
                  ? (MIME_LABELS[details.entry.mimeType] ?? details.entry.mimeType)
                  : "fichier"}
              </dd>
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

      {/* Visionneuse intégrée : image, PDF ou texte selon le type du fichier. */}
      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview ? preview.entry.name : "Aperçu"}
        className="max-w-3xl"
        footer={
          preview ? (
            <>
              <a href={`/api/drive/download/${preview.entry.id}`} download>
                <Button size="sm" variant="outline">
                  Télécharger
                </Button>
              </a>
              <a href={previewUrl(preview.entry.id)} target="_blank" rel="noreferrer">
                <Button size="sm">Ouvrir dans un nouvel onglet</Button>
              </a>
            </>
          ) : null
        }
      >
        {preview ? (
          preview.mode === "image" ? (
            // L'image n'annonce jamais un succès optimiste : elle reste voilée
            // tant que le navigateur n'a pas confirmé le chargement (`onLoad`),
            // et un échec de décodage bascule sur un message avec issue.
            previewImage === "error" ? (
              <Alert tone="danger" title="Aperçu impossible">
                {imagePreviewErrorMessage()}
              </Alert>
            ) : (
              <div className="relative flex min-h-40 items-center justify-center rounded-md bg-muted p-2">
                <img
                  src={previewUrl(preview.entry.id)}
                  alt={preview.entry.name}
                  onLoad={() => setPreviewImage("ready")}
                  onError={() => setPreviewImage("error")}
                  className={cn(
                    "max-h-[70vh] w-full object-contain",
                    previewImage === "loading" ? "opacity-0" : undefined,
                  )}
                />
                {previewImage === "loading" ? (
                  <LoadingState
                    className="absolute inset-0 py-0"
                    label="Chargement de l'aperçu…"
                    size={20}
                  />
                ) : null}
              </div>
            )
          ) : preview.mode === "pdf" ? (
            <iframe
              src={previewUrl(preview.entry.id)}
              title={preview.entry.name}
              className="h-[70vh] w-full rounded-md border border-border"
            />
          ) : previewText.status === "loading" ? (
            <LoadingState className="py-0" label="Chargement de l'aperçu…" size={20} />
          ) : previewText.status === "error" ? (
            <Alert tone="danger" title="Aperçu impossible">
              {textPreviewErrorMessage()}
            </Alert>
          ) : (
            <div className="flex flex-col gap-2">
              <pre className="max-h-[70vh] overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
                {previewText.text}
              </pre>
              {previewText.truncated ? (
                <p className="text-xs text-muted-foreground">{truncatedNotice()}</p>
              ) : null}
            </div>
          )
        ) : null}
      </Dialog>

      {/* Déplacement et suppression de la sélection */}
      <MoveDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        entries={selectedEntries}
        busy={bulkBusy}
        onConfirm={(targetParentId) => void onMoveSelected(targetParentId)}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void onDeleteSelected()}
        title="Mettre la sélection à la corbeille ?"
        message={
          selection.ids.size === 1 ? (
            "L'élément sélectionné sera mis à la corbeille. Son contenu reste stocké et pourra être restauré depuis la corbeille."
          ) : (
            <>
              <p>
                {`Les ${selection.ids.size} éléments sélectionnés seront mis à la corbeille. Leur contenu reste stocké et pourra être restauré depuis la corbeille.`}
              </p>
              {selectedEntries.length > 0 ? (
                <p className="mt-2 text-xs">
                  {selectedEntries
                    .slice(0, 5)
                    .map((entry) => entry.name)
                    .join(", ")}
                  {selectedEntries.length > 5 ? ` et ${selectedEntries.length - 5} autre(s)…` : ""}
                </p>
              ) : null}
            </>
          )
        }
        confirmLabel="Mettre à la corbeille"
        destructive
        busy={bulkBusy}
      />

      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
