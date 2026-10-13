import {
  Badge,
  Button,
  ConfirmDialog,
  cn,
  Dialog,
  EmptyState,
  IconMail,
  Input,
  Label,
  PageHeader,
  SegmentedTabs,
  Toasts,
  useToasts,
} from "@workspace/ui";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  type AttachmentToken,
  deleteMessageFn,
  type FolderCounts,
  type FolderKey,
  getMailboxFn,
  getMessageFn,
  listFoldersFn,
  listMessagesFn,
  listThreadMessagesFn,
  type MessageDetail,
  type MessageSummary,
  restoreMessageFn,
  saveDraftFn,
  sendMailFn,
  type ThreadSummary,
  toggleStarFn,
  trashMessageFn,
  uploadMailAttachmentFn,
} from "../server.ts";

const FOLDER_LABELS: Record<FolderKey, string> = {
  inbox: "Boîte de réception",
  sent: "Envoyés",
  drafts: "Brouillons",
  trash: "Corbeille",
};

const EMPTY_HINTS: Record<FolderKey, string> = {
  inbox: "Votre boîte est vide.",
  sent: "Aucun message envoyé.",
  drafts: "Aucun brouillon en cours.",
  trash: "La corbeille est vide.",
};

function fmtDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Bornes du compositeur, alignées sur le service (MAX_ATTACHMENTS / 10 Mio). */
const COMPOSER_MAX_ATTACHMENTS = 5;
const COMPOSER_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Lit un fichier local en base64 (sans préfixe data:) pour le serveur. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Lecture de « ${file.name} » impossible.`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) {
        reject(new Error(`Lecture de « ${file.name} » impossible.`));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

type Composer = {
  id?: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  attachments: AttachmentToken[];
};

/** Liste des pièces jointes d'un message lues (liens de téléchargement). */
function AttachmentLinks({ attachments }: { attachments: MessageDetail["attachments"] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-2">
      <p className="text-xs font-medium text-muted-foreground">
        Pièce{attachments.length > 1 ? "s" : ""} jointe{attachments.length > 1 ? "s" : ""} (
        {attachments.length})
      </p>
      <ul className="flex flex-col gap-0.5">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <a
              href={`/api/mail/attachments/${attachment.id}`}
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              📎 {attachment.filename}{" "}
              <span className="text-xs text-muted-foreground">
                ({fmtSize(attachment.sizeBytes)})
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

type ViewMode = "conversations" | "messages";

const VIEW_TABS: { id: ViewMode; label: string }[] = [
  { id: "conversations", label: "Conversations" },
  { id: "messages", label: "Messages" },
];

/**
 * Mail — boîtes locales par utilisateur, dossiers, recherche, brouillons,
 * envoi (SMTP optionnel, l'échec est toujours visible sur le message) et fils
 * de discussion (affichage « Conversations » par défaut).
 */
export function MailView() {
  const [address, setAddress] = useState("");
  const [folders, setFolders] = useState<FolderCounts | null>(null);
  const [folder, setFolder] = useState<FolderKey>("inbox");
  const [mode, setMode] = useState<ViewMode>("conversations");
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [selectedThread, setSelectedThread] = useState<{
    threadKey: string;
    messages: MessageDetail[];
  } | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { toasts, push, dismiss } = useToasts();
  const [confirmDeleteForever, setConfirmDeleteForever] = useState(false);

  const refreshFolders = useCallback(async () => {
    setFolders(await listFoldersFn());
  }, []);

  const refreshList = useCallback(async () => {
    if (mode === "conversations") {
      const list = await listMessagesFn({
        data: { folder, query, unreadOnly, starredOnly, threaded: true },
      });
      // threaded: true → le serveur renvoie des fils (listMessages).
      setThreads(list as ThreadSummary[]);
    } else {
      const list = await listMessagesFn({ data: { folder, query, unreadOnly, starredOnly } });
      setMessages(list as MessageSummary[]);
    }
  }, [folder, query, unreadOnly, starredOnly, mode]);

  useEffect(() => {
    void (async () => {
      try {
        const mailbox = await getMailboxFn();
        setAddress(mailbox.address);
        await refreshFolders();
      } catch (caught) {
        push("danger", caught instanceof Error ? caught.message : "Chargement impossible.");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshFolders, push]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshList().catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [refreshList]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshList().catch(() => undefined);
      void refreshFolders().catch(() => undefined);
    }, 8000);
    return () => clearInterval(interval);
  }, [refreshList, refreshFolders]);

  async function refreshAll() {
    await Promise.all([refreshList(), refreshFolders()]);
  }

  async function openMessage(messageId: string) {
    try {
      setSelected(await getMessageFn({ data: { messageId } }));
      await refreshAll();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Ouverture impossible.");
    }
  }

  async function openThread(thread: ThreadSummary) {
    try {
      const threadMessages = await listThreadMessagesFn({
        data: { messageId: thread.latest.id },
      });
      setSelectedThread({ threadKey: thread.threadKey, messages: threadMessages });
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Ouverture impossible.");
    }
  }

  function openComposer(base?: Partial<Omit<Composer, "attachments">>) {
    setComposer({ to: "", cc: "", subject: "", body: "", attachments: [], ...base });
  }

  function replyTo(message: MessageDetail) {
    const subject = message.subject.startsWith("Re:") ? message.subject : `Re: ${message.subject}`;
    openComposer({
      to: message.fromAddress,
      subject,
      body: `\n\n— ${message.fromName ?? message.fromAddress} a écrit :\n> ${message.body.replaceAll("\n", "\n> ")}`,
    });
  }

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!composer) return;
    setBusy(true);
    try {
      const result = await sendMailFn({
        data: {
          id: composer.id,
          to: splitAddresses(composer.to),
          cc: splitAddresses(composer.cc),
          subject: composer.subject,
          body: composer.body,
          attachments: composer.attachments.length > 0 ? composer.attachments : undefined,
        },
      });
      if (result.sendError) {
        push("danger", result.sendError);
      }
      setComposer(null);
      setFolder("sent");
      setSelected(null);
      await refreshAll();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Téléverse les fichiers choisis un par un (jetons provisoires), avec les
   * bornes du serveur appliquées côté client : 5 fichiers, 10 Mo chacun.
   */
  async function onPickAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!composer || files.length === 0) return;

    const remaining = COMPOSER_MAX_ATTACHMENTS - composer.attachments.length;
    if (remaining <= 0) {
      push("danger", `${COMPOSER_MAX_ATTACHMENTS} pièces jointes au maximum.`);
      return;
    }
    if (files.length > remaining) {
      push(
        "danger",
        `${COMPOSER_MAX_ATTACHMENTS} pièces jointes au maximum (${remaining} emplacement${remaining > 1 ? "s" : ""} restant${remaining > 1 ? "s" : ""}).`,
      );
    }

    setBusy(true);
    try {
      let updated = composer;
      for (const file of files.slice(0, remaining)) {
        if (file.size > COMPOSER_MAX_ATTACHMENT_BYTES) {
          push("danger", `« ${file.name} » dépasse 10 Mo.`);
          continue;
        }
        try {
          const contentBase64 = await fileToBase64(file);
          const token = await uploadMailAttachmentFn({
            data: {
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              contentBase64,
            },
          });
          updated = { ...updated, attachments: [...updated.attachments, token] };
          setComposer(updated);
        } catch (caught) {
          push(
            "danger",
            caught instanceof Error
              ? caught.message
              : `Téléversement de « ${file.name} » impossible.`,
          );
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function removeAttachment(storageKey: string) {
    if (!composer) return;
    setComposer({
      ...composer,
      attachments: composer.attachments.filter((token) => token.storageKey !== storageKey),
    });
  }

  async function onSaveDraft() {
    if (!composer) return;
    if (composer.attachments.length > 0) {
      push("danger", "Les pièces jointes ne sont conservées qu'à l'envoi — envoyez le message.");
      return;
    }
    setBusy(true);
    try {
      await saveDraftFn({
        data: {
          id: composer.id,
          to: splitAddresses(composer.to),
          cc: splitAddresses(composer.cc),
          subject: composer.subject,
          body: composer.body,
        },
      });
      setComposer(null);
      await refreshAll();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Cible des actions de lecture : le message sélectionné (mode Messages) ou le
  // dernier message du fil (mode Conversations — KISS : on agit sur le dernier).
  const threadLatest = selectedThread?.messages.at(-1) ?? null;
  const activeMessage = mode === "conversations" ? threadLatest : selected;

  async function onToggleStar(messageId: string) {
    const result = await toggleStarFn({ data: { messageId } });
    await refreshAll();
    if (selected?.id === messageId) {
      setSelected(await getMessageFn({ data: { messageId } }));
    }
    if (selectedThread?.messages.some((message) => message.id === messageId)) {
      setSelectedThread({
        ...selectedThread,
        messages: selectedThread.messages.map((message) =>
          message.id === messageId ? { ...message, starred: result.starred } : message,
        ),
      });
    }
  }

  async function onTrash() {
    if (!activeMessage) return;
    setBusy(true);
    try {
      await trashMessageFn({ data: { messageId: activeMessage.id } });
      setSelected(null);
      setSelectedThread(null);
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function onRestore() {
    if (!activeMessage) return;
    setBusy(true);
    try {
      await restoreMessageFn({ data: { messageId: activeMessage.id } });
      setSelected(null);
      setSelectedThread(null);
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteForever() {
    if (!activeMessage) return;
    setBusy(true);
    try {
      await deleteMessageFn({ data: { messageId: activeMessage.id } });
      setConfirmDeleteForever(false);
      setSelected(null);
      setSelectedThread(null);
      await refreshAll();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  const folderEntries = useMemo(() => Object.keys(FOLDER_LABELS) as FolderKey[], []);

  return (
    <div className="mx-auto flex h-[calc(100vh-8.5rem)] max-w-6xl flex-col gap-3">
      <PageHeader
        title="Mail"
        description={address ? `Boîte de ${address}` : undefined}
        actions={
          <Button size="sm" onClick={() => openComposer()}>
            Écrire
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="flex w-52 shrink-0 flex-col gap-3 rounded-xl border border-border bg-card p-3">
          <p className="truncate text-xs text-muted-foreground" title={address}>
            {address || "…"}
          </p>
          <nav aria-label="Dossiers" className="flex flex-col gap-1">
            {folderEntries.map((key) => {
              const counts = folders?.[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setFolder(key);
                    setSelected(null);
                    setSelectedThread(null);
                    setUnreadOnly(false);
                    setStarredOnly(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                    key === folder ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                  )}
                >
                  <span className="truncate">{FOLDER_LABELS[key]}</span>
                  <span className="ml-auto flex items-center gap-1">
                    {counts && counts.unread > 0 && key !== "sent" && key !== "drafts" ? (
                      <Badge>{counts.unread}</Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">{counts?.total ?? ""}</span>
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="mt-auto flex flex-col gap-1 text-xs">
            <button
              type="button"
              onClick={() => setUnreadOnly((current) => !current)}
              className={cn(
                "rounded-lg px-2 py-1.5 text-left transition-colors",
                unreadOnly ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              Non lus uniquement
            </button>
            <button
              type="button"
              onClick={() => setStarredOnly((current) => !current)}
              className={cn(
                "rounded-lg px-2 py-1.5 text-left transition-colors",
                starredOnly ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              Suivis ★
            </button>
          </div>
        </aside>

        <section className="flex w-80 shrink-0 flex-col rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-2 border-b border-border p-2">
            <SegmentedTabs
              ariaLabel="Affichage"
              items={VIEW_TABS}
              value={mode}
              onChange={(next) => setMode(next)}
            />
            <Input
              aria-label="Rechercher dans les messages"
              placeholder="Rechercher…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8"
            />
          </div>
          {loading ? (
            <ul className="flex flex-1 flex-col divide-y divide-border overflow-y-auto">
              <li className="p-3 text-xs text-muted-foreground">Chargement…</li>
            </ul>
          ) : mode === "conversations" ? (
            threads.length === 0 ? (
              <EmptyState
                icon={<IconMail />}
                title="Aucune conversation."
                hint={EMPTY_HINTS[folder]}
                className="flex-1 justify-center border-0 bg-transparent"
              />
            ) : (
              <ul className="flex flex-1 flex-col divide-y divide-border overflow-y-auto">
                {threads.map((thread) => (
                  <li key={thread.threadKey}>
                    <button
                      type="button"
                      onClick={() => void openThread(thread)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                        thread.threadKey === selectedThread?.threadKey && "bg-accent/60",
                        thread.unreadCount > 0 && "font-medium",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {thread.unreadCount > 0 ? (
                          <span
                            aria-label="Non lu"
                            className="size-1.5 rounded-full bg-primary"
                            role="img"
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">
                          {folder === "sent" || folder === "drafts"
                            ? `À : ${thread.latest.toAddresses.join(", ") || "(sans destinataire)"}`
                            : (thread.latest.fromName ?? thread.latest.fromAddress)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDate(thread.latest.createdAt)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {thread.subject || "(sans objet)"}
                        </span>
                        {thread.messageCount > 1 ? <Badge>{thread.messageCount}</Badge> : null}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {thread.latest.snippet}
                        </span>
                        {thread.latest.attachmentCount > 0 ? (
                          <span
                            className="text-[10px] text-muted-foreground"
                            title="Pièces jointes"
                          >
                            📎 {thread.latest.attachmentCount}
                          </span>
                        ) : null}
                        {thread.latest.starred ? <span className="text-attention">★</span> : null}
                        {thread.latest.sendError ? (
                          <span
                            className="text-[10px] text-destructive"
                            title={thread.latest.sendError}
                          >
                            ⚠
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : messages.length === 0 ? (
            <EmptyState
              icon={<IconMail />}
              title="Aucun message."
              hint={EMPTY_HINTS[folder]}
              className="flex-1 justify-center border-0 bg-transparent"
            />
          ) : (
            <ul className="flex flex-1 flex-col divide-y divide-border overflow-y-auto">
              {messages.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => void openMessage(message.id)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                      message.id === selected?.id && "bg-accent/60",
                      !message.read && "font-medium",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {!message.read ? (
                        <span
                          aria-label="Non lu"
                          className="size-1.5 rounded-full bg-primary"
                          role="img"
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">
                        {folder === "sent" || folder === "drafts"
                          ? `À : ${message.toAddresses.join(", ") || "(sans destinataire)"}`
                          : (message.fromName ?? message.fromAddress)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {fmtDate(message.createdAt)}
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {message.subject || "(sans objet)"}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {message.snippet}
                      </span>
                      {message.attachmentCount > 0 ? (
                        <span className="text-[10px] text-muted-foreground" title="Pièces jointes">
                          📎 {message.attachmentCount}
                        </span>
                      ) : null}
                      {message.starred ? <span className="text-attention">★</span> : null}
                      {message.sendError ? (
                        <span className="text-[10px] text-destructive" title={message.sendError}>
                          ⚠
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
          {mode === "conversations" && selectedThread ? (
            <>
              <header className="flex flex-wrap items-start gap-2 border-b border-border p-4">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg font-semibold tracking-tight">
                    {threadLatest?.subject || "(sans objet)"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {selectedThread.messages.length} message
                    {selectedThread.messages.length > 1 ? "s" : ""} dans la conversation
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={threadLatest?.starred ? "Retirer le suivi" : "Suivre"}
                    onClick={() => threadLatest && void onToggleStar(threadLatest.id)}
                  >
                    {threadLatest?.starred ? "★" : "☆"}
                  </Button>
                  {folder !== "sent" && folder !== "drafts" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => threadLatest && replyTo(threadLatest)}
                    >
                      Répondre
                    </Button>
                  ) : null}
                  {folder === "drafts" && threadLatest ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        openComposer({
                          id: threadLatest.id,
                          to: threadLatest.toAddresses.join(", "),
                          cc: threadLatest.ccAddresses.join(", "),
                          subject: threadLatest.subject,
                          body: threadLatest.body,
                        })
                      }
                    >
                      Modifier
                    </Button>
                  ) : null}
                  {folder === "trash" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy}
                        onClick={() => void onRestore()}
                      >
                        Restaurer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        loading={busy}
                        onClick={() => setConfirmDeleteForever(true)}
                      >
                        Supprimer définitivement
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      loading={busy}
                      onClick={() => void onTrash()}
                    >
                      Corbeille
                    </Button>
                  )}
                </div>
              </header>
              <div className="flex-1 overflow-y-auto">
                {selectedThread.messages.map((message, index) => (
                  <article
                    key={message.id}
                    className={cn("flex flex-col gap-2 p-4", index > 0 && "border-t border-border")}
                  >
                    <header className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {message.fromName ?? message.fromAddress}{" "}
                          <span className="font-normal text-muted-foreground">
                            &lt;{message.fromAddress}&gt;
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          À : {message.toAddresses.join(", ")}
                          {message.ccAddresses.length > 0
                            ? ` · Cc : ${message.ccAddresses.join(", ")}`
                            : ""}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(message.sentAt ?? message.createdAt).toLocaleString("fr-FR")}
                      </span>
                    </header>
                    {message.sendError ? (
                      <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                        {message.sendError}
                      </p>
                    ) : null}
                    <div className="whitespace-pre-wrap text-sm">
                      {message.body || "(message vide)"}
                    </div>
                    <AttachmentLinks attachments={message.attachments} />
                  </article>
                ))}
              </div>
            </>
          ) : selected ? (
            <>
              <header className="flex flex-wrap items-start gap-2 border-b border-border p-4">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg font-semibold tracking-tight">
                    {selected.subject || "(sans objet)"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {selected.fromName ?? selected.fromAddress} &lt;{selected.fromAddress}&gt; ·{" "}
                    {new Date(selected.sentAt ?? selected.createdAt).toLocaleString("fr-FR")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    À : {selected.toAddresses.join(", ")}
                    {selected.ccAddresses.length > 0
                      ? ` · Cc : ${selected.ccAddresses.join(", ")}`
                      : ""}
                  </p>
                  {selected.sendError ? (
                    <p className="mt-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                      {selected.sendError}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={selected.starred ? "Retirer le suivi" : "Suivre"}
                    onClick={() => void onToggleStar(selected.id)}
                  >
                    {selected.starred ? "★" : "☆"}
                  </Button>
                  {folder !== "sent" && folder !== "drafts" ? (
                    <Button size="sm" variant="outline" onClick={() => replyTo(selected)}>
                      Répondre
                    </Button>
                  ) : null}
                  {folder === "drafts" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        openComposer({
                          id: selected.id,
                          to: selected.toAddresses.join(", "),
                          cc: selected.ccAddresses.join(", "),
                          subject: selected.subject,
                          body: selected.body,
                        })
                      }
                    >
                      Modifier
                    </Button>
                  ) : null}
                  {folder === "trash" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy}
                        onClick={() => void onRestore()}
                      >
                        Restaurer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        loading={busy}
                        onClick={() => setConfirmDeleteForever(true)}
                      >
                        Supprimer définitivement
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      loading={busy}
                      onClick={() => void onTrash()}
                    >
                      Corbeille
                    </Button>
                  )}
                </div>
              </header>
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
                <div className="whitespace-pre-wrap text-sm">
                  {selected.body || "(message vide)"}
                </div>
                <AttachmentLinks attachments={selected.attachments} />
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-6">
              <p className="text-sm text-muted-foreground">
                {mode === "conversations"
                  ? "Sélectionnez une conversation."
                  : "Sélectionnez un message."}
              </p>
            </div>
          )}
        </section>
      </div>

      <Toasts toasts={toasts} dismiss={dismiss} />

      <Dialog
        open={composer !== null}
        onClose={() => setComposer(null)}
        title={composer?.id ? "Modifier le brouillon" : "Nouveau message"}
        className="max-w-2xl"
      >
        {composer ? (
          <form onSubmit={onSend} method="post" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="mail-to">À (séparés par des virgules)</Label>
              <Input
                id="mail-to"
                value={composer.to}
                onChange={(event) => setComposer({ ...composer, to: event.target.value })}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="mail-cc">Cc</Label>
              <Input
                id="mail-cc"
                value={composer.cc}
                onChange={(event) => setComposer({ ...composer, cc: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="mail-subject">Objet</Label>
              <Input
                id="mail-subject"
                value={composer.subject}
                onChange={(event) => setComposer({ ...composer, subject: event.target.value })}
                maxLength={500}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="mail-body">Message</Label>
              <textarea
                id="mail-body"
                value={composer.body}
                onChange={(event) => setComposer({ ...composer, body: event.target.value })}
                rows={10}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="mail-attachments">Pièces jointes (5 max, 10 Mo chacune)</Label>
              <Input
                id="mail-attachments"
                type="file"
                multiple
                aria-label="Pièces jointes"
                disabled={busy}
                onChange={(event) => void onPickAttachments(event)}
                className="h-auto py-1.5"
              />
              {composer.attachments.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {composer.attachments.map((attachment) => (
                    <li
                      key={attachment.storageKey}
                      className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate" title={attachment.filename}>
                        {attachment.filename}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {fmtSize(attachment.sizeBytes)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Retirer ${attachment.filename}`}
                        onClick={() => removeAttachment(attachment.storageKey)}
                        className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setComposer(null)}>
                Annuler
              </Button>
              <Button
                type="button"
                variant="outline"
                loading={busy}
                onClick={() => void onSaveDraft()}
              >
                Enregistrer en brouillon
              </Button>
              <Button type="submit" loading={busy}>
                Envoyer
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteForever}
        onClose={() => setConfirmDeleteForever(false)}
        onConfirm={() => void onDeleteForever()}
        title="Supprimer le message ?"
        message="Ce message sera définitivement supprimé."
        confirmLabel="Supprimer définitivement"
        busy={busy}
        destructive
      />
    </div>
  );
}
