import {
  Badge,
  Button,
  ConfirmDialog,
  cn,
  IconMail,
  Menu,
  type MenuItem,
  PageHeader,
  SegmentedTabs,
  Toasts,
  useToasts,
} from "@workspace/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  archiveMessageFn,
  deleteMessageFn,
  type FolderCounts,
  type FolderKey,
  getMailboxFn,
  getMessageFn,
  listFoldersFn,
  listLabelCountsFn,
  listLabelsFn,
  listMessagesFn,
  listThreadMessagesFn,
  type MailLabel,
  type MessageDetail,
  type MessageSummary,
  markThreadReadFn,
  restoreMessageFn,
  sendMailFn,
  setMessageLabelsFn,
  type ThreadSummary,
  toggleStarFn,
  trashMessageFn,
} from "../server.ts";
import { formatFileSize } from "./attachments.ts";
import { ComposerDialog, type ComposerSeed, EMPTY_SEED } from "./composer.tsx";
import { FilterBar } from "./filter-bar.tsx";
import { EMPTY_FILTERS, type MailFilters } from "./filters.ts";
import { LabelChip } from "./label-chip.tsx";
import { LabelsPanel, ManageLabelsDialog } from "./labels-panel.tsx";
import {
  type ExpandedMessage,
  MessageList,
  MessageListEmpty,
  type MessageListItem,
  PaperclipGlyph,
} from "./message-list.tsx";
import { quoteOriginal, replyAllCopies, replyAllRecipients, replySubject } from "./reply.ts";
import { clampIndex, type MailAction, stepIndex, useMailShortcuts } from "./shortcuts.ts";
import { ShortcutsHelp } from "./shortcuts-help.tsx";

const FOLDER_LABELS: Record<FolderKey, string> = {
  inbox: "Boîte de réception",
  archive: "Archives",
  sent: "Envoyés",
  drafts: "Brouillons",
  trash: "Corbeille",
};

const EMPTY_HINTS: Record<FolderKey, string> = {
  inbox: "Votre boîte est vide.",
  archive: "Aucun message archivé.",
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

/** Séparation des adresses d'un champ libre historique (brouillons, messages). */
function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

type ViewMode = "conversations" | "messages";

const VIEW_TABS: { id: ViewMode; label: string }[] = [
  { id: "conversations", label: "Conversations" },
  { id: "messages", label: "Messages" },
];

/** Réponse rédigée en place sous la conversation lue (jamais dans un panneau). */
type ReplyDraft = {
  to: string[];
  cc: string[];
  subject: string;
  quote: string;
};

function threadToItem(thread: ThreadSummary, folder: FolderKey): MessageListItem {
  const latest = thread.latest;
  return {
    key: thread.threadKey,
    messageId: latest.id,
    title:
      folder === "sent" || folder === "drafts"
        ? latest.toAddresses.join(", ") || "(sans destinataire)"
        : (latest.fromName ?? latest.fromAddress),
    subject: thread.subject,
    snippet: latest.snippet,
    date: fmtDate(latest.createdAt),
    unread: thread.unreadCount > 0,
    starred: latest.starred,
    count: thread.messageCount,
    attachmentCount: latest.attachmentCount,
    sendError: latest.sendError,
    labels: thread.labels,
  };
}

function messageToItem(message: MessageSummary, folder: FolderKey): MessageListItem {
  return {
    key: message.id,
    messageId: message.id,
    title:
      folder === "sent" || folder === "drafts"
        ? message.toAddresses.join(", ") || "(sans destinataire)"
        : (message.fromName ?? message.fromAddress),
    subject: message.subject,
    snippet: message.snippet,
    date: fmtDate(message.createdAt),
    unread: !message.read,
    starred: message.starred,
    attachmentCount: message.attachmentCount,
    sendError: message.sendError,
    labels: message.labels,
  };
}

function toExpandedMessage(message: MessageDetail, folder: FolderKey): ExpandedMessage {
  return {
    id: message.id,
    title:
      folder === "sent" || folder === "drafts"
        ? message.toAddresses.join(", ") || "(sans destinataire)"
        : (message.fromName ?? message.fromAddress),
    subject: message.subject,
    snippet: message.snippet,
    date: fmtDate(message.createdAt),
    unread: !message.read,
    starred: message.starred,
  };
}

/**
 * Mail — boîtes locales par utilisateur, dossiers, filtres, libellés
 * personnels, conversations dépliables, brouillons, envoi (SMTP optionnel,
 * l'échec est toujours visible sur le message) et raccourcis clavier
 * (j/k, n, e, r, s, ?, /).
 */
export function MailView() {
  const [address, setAddress] = useState("");
  const [folders, setFolders] = useState<FolderCounts | null>(null);
  const [folder, setFolder] = useState<FolderKey>("inbox");
  const [mode, setMode] = useState<ViewMode>("conversations");
  const [filters, setFilters] = useState<MailFilters>(EMPTY_FILTERS);
  const [labels, setLabels] = useState<MailLabel[]>([]);
  const [labelCounts, setLabelCounts] = useState<Record<string, { total: number; unread: number }>>(
    {},
  );
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [selectedThread, setSelectedThread] = useState<{
    threadKey: string;
    messages: MessageDetail[];
  } | null>(null);
  const [composer, setComposer] = useState<ComposerSeed | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focusNonce, setFocusNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteForever, setConfirmDeleteForever] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [reply, setReply] = useState<ReplyDraft | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<ExpandedMessage[] | null>(null);
  const { toasts, push, dismiss } = useToasts();
  const searchRef = useRef<HTMLInputElement>(null);

  const refreshFolders = useCallback(async () => {
    setFolders(await listFoldersFn());
  }, []);

  const refreshLabels = useCallback(async () => {
    const [list, counts] = await Promise.all([listLabelsFn(), listLabelCountsFn()]);
    setLabels(list);
    setLabelCounts(counts);
  }, []);

  const refreshList = useCallback(async () => {
    const data = {
      folder,
      query: filters.query,
      from: filters.from,
      to: filters.to,
      unreadOnly: filters.unreadOnly,
      starredOnly: filters.starredOnly,
      hasAttachment: filters.hasAttachment,
      labelId: filters.labelId ?? undefined,
    };
    if (mode === "conversations") {
      const list = await listMessagesFn({ data: { ...data, threaded: true } });
      // threaded: true → le serveur renvoie des fils (listMessages).
      setThreads(list as ThreadSummary[]);
    } else {
      const list = await listMessagesFn({ data });
      setMessages(list as MessageSummary[]);
    }
  }, [
    folder,
    filters.query,
    filters.from,
    filters.to,
    filters.unreadOnly,
    filters.starredOnly,
    filters.hasAttachment,
    filters.labelId,
    mode,
  ]);

  useEffect(() => {
    void (async () => {
      try {
        const mailbox = await getMailboxFn();
        setAddress(mailbox.address);
        await Promise.all([refreshFolders(), refreshLabels()]);
      } catch (caught) {
        push("danger", caught instanceof Error ? caught.message : "Chargement impossible.");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshFolders, refreshLabels, push]);

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

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshList(), refreshFolders(), refreshLabels()]);
  }, [refreshList, refreshFolders, refreshLabels]);

  // -------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------

  const items = useMemo<MessageListItem[]>(
    () =>
      mode === "conversations"
        ? threads.map((thread) => threadToItem(thread, folder))
        : messages.map((message) => messageToItem(message, folder)),
    [mode, threads, messages, folder],
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Une liste qui rétrécit (message archivé, corbeille) ne peut pas laisser la
  // sélection pointer dans le vide.
  useEffect(() => {
    setActiveIndex((current) => clampIndex(current, items.length));
  }, [items.length]);

  // Un fil disparu de la liste (archivé, filtré) ne reste pas déplié.
  useEffect(() => {
    if (expandedKey !== null && !items.some((item) => item.key === expandedKey)) {
      setExpandedKey(null);
      setExpandedMessages(null);
    }
  }, [expandedKey, items]);

  const selectedKey =
    mode === "conversations" ? (selectedThread?.threadKey ?? null) : (selected?.id ?? null);

  const openMessage = useCallback(
    async (messageId: string) => {
      try {
        setSelected(await getMessageFn({ data: { messageId } }));
        await refreshAll();
      } catch (caught) {
        push("danger", caught instanceof Error ? caught.message : "Ouverture impossible.");
      }
    },
    [push, refreshAll],
  );

  const openThread = useCallback(
    async (thread: ThreadSummary) => {
      try {
        const threadMessages = await listThreadMessagesFn({
          data: { messageId: thread.latest.id },
        });
        setSelectedThread({ threadKey: thread.threadKey, messages: threadMessages });
      } catch (caught) {
        push("danger", caught instanceof Error ? caught.message : "Ouverture impossible.");
      }
    },
    [push],
  );

  const selectItem = useCallback(
    (item: MessageListItem, index: number) => {
      setActiveIndex(index);
      setReply(null);
      setReplyBody("");
      if (mode === "conversations") {
        const thread = threads.find((entry) => entry.threadKey === item.key);
        if (thread) void openThread(thread);
      } else {
        void openMessage(item.messageId);
      }
    },
    [mode, threads, openMessage, openThread],
  );

  /** Déplie/replie une conversation et charge ses messages au besoin. */
  const toggleExpand = useCallback(
    async (item: MessageListItem) => {
      if (expandedKey === item.key) {
        setExpandedKey(null);
        setExpandedMessages(null);
        return;
      }
      setExpandedKey(item.key);
      setExpandedMessages(null);
      try {
        const loaded = await listThreadMessagesFn({ data: { messageId: item.messageId } });
        setExpandedMessages(loaded.map((message) => toExpandedMessage(message, folder)));
      } catch (caught) {
        setExpandedMessages([]);
        push("danger", caught instanceof Error ? caught.message : "Ouverture du fil impossible.");
      }
    },
    [expandedKey, folder, push],
  );

  const openComposer = useCallback((base?: Partial<ComposerSeed>) => {
    setReply(null);
    setReplyBody("");
    setComposer({ ...EMPTY_SEED, ...base });
  }, []);

  /** Ouvre la réponse en place, sous la conversation lue. */
  const replyTo = useCallback(
    (message: MessageDetail, mode: "reply" | "replyAll" = "reply") => {
      setComposer(null);
      setReplyBody("");
      if (mode === "reply") {
        setReply({
          to: splitAddresses(message.fromAddress),
          cc: [],
          subject: replySubject(message.subject),
          quote: quoteOriginal(message),
        });
        return;
      }
      setReply({
        to: replyAllRecipients({
          fromAddress: message.fromAddress,
          toAddresses: message.toAddresses,
          ccAddresses: message.ccAddresses,
          responder: address,
        }),
        cc: replyAllCopies({ ccAddresses: message.ccAddresses, responder: address }),
        subject: replySubject(message.subject),
        quote: quoteOriginal(message),
      });
    },
    [address],
  );

  const closeReply = useCallback(() => {
    setReply(null);
    setReplyBody("");
  }, []);

  /** Envoie la réponse rédigée en place : le fil reste affiché. */
  const sendReply = useCallback(async () => {
    if (!reply || replyBusy) return;
    if (reply.to.length === 0) {
      push("danger", "Ajoutez au moins un destinataire avant d'envoyer.");
      return;
    }
    setReplyBusy(true);
    try {
      const result = await sendMailFn({
        data: {
          to: reply.to,
          cc: reply.cc,
          subject: reply.subject,
          body: `${replyBody}${reply.quote}`,
        },
      });
      closeReply();
      push(result.sendError ? "danger" : "success", result.sendError ?? "Réponse envoyée.");
      await refreshAll();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Envoi impossible.");
    } finally {
      setReplyBusy(false);
    }
  }, [reply, replyBody, replyBusy, closeReply, push, refreshAll]);

  /** Reprend la réponse en cours dans le compositeur complet (Cci, pièces jointes). */
  const expandReply = useCallback(() => {
    if (!reply) return;
    openComposer({
      to: reply.to,
      cc: reply.cc,
      subject: reply.subject,
      body: `${replyBody}${reply.quote}`,
    });
  }, [reply, replyBody, openComposer]);

  const onSent = useCallback(
    async (result: { sendError: string | null }) => {
      setComposer(null);
      setFolder("sent");
      setSelected(null);
      setSelectedThread(null);
      if (result.sendError) push("danger", result.sendError);
      await refreshAll();
    },
    [push, refreshAll],
  );

  const onDraftSaved = useCallback(() => {
    void refreshAll();
  }, [refreshAll]);

  const onComposerError = useCallback(
    (message: string) => {
      push("danger", message);
    },
    [push],
  );

  // -------------------------------------------------------------------------
  // Actions sur le message affiché
  // -------------------------------------------------------------------------

  const threadLatest = selectedThread?.messages.at(-1) ?? null;
  const activeMessage = mode === "conversations" ? threadLatest : selected;

  const onToggleStar = useCallback(
    async (messageId: string) => {
      try {
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
        if (expandedKey !== null && expandedMessages !== null) {
          setExpandedMessages(
            expandedMessages.map((message) =>
              message.id === messageId ? { ...message, starred: result.starred } : message,
            ),
          );
        }
      } catch (caught) {
        push("danger", caught instanceof Error ? caught.message : "Action impossible.");
      }
    },
    [push, refreshAll, selected, selectedThread, expandedKey, expandedMessages],
  );

  /** Applique un ensemble exact de libellés au message affiché. */
  const onApplyLabels = useCallback(
    async (messageId: string, labelIds: string[]) => {
      setBusy(true);
      try {
        const { labels: applied } = await setMessageLabelsFn({
          data: { messageId, labelIds },
        });
        if (selected?.id === messageId) setSelected({ ...selected, labels: applied });
        if (selectedThread) {
          setSelectedThread({
            ...selectedThread,
            messages: selectedThread.messages.map((message) =>
              message.id === messageId ? { ...message, labels: applied } : message,
            ),
          });
        }
        await refreshAll();
        push(
          "success",
          applied.length === 0
            ? "Libellés retirés."
            : `Libellé${applied.length > 1 ? "s" : ""} appliqué${applied.length > 1 ? "s" : ""} : ${applied
                .map((label) => label.name)
                .join(", ")}.`,
        );
      } catch (caught) {
        push("danger", caught instanceof Error ? caught.message : "Application impossible.");
      } finally {
        setBusy(false);
      }
    },
    [push, refreshAll, selected, selectedThread],
  );

  /** Bascule un libellé depuis le menu de la lecture (application immédiate). */
  const toggleMessageLabel = useCallback(
    (messageId: string, currentIds: string[], labelId: string) => {
      const next = currentIds.includes(labelId)
        ? currentIds.filter((id) => id !== labelId)
        : [...currentIds, labelId];
      void onApplyLabels(messageId, next);
    },
    [onApplyLabels],
  );

  /** Marque comme lus tous les messages de la conversation affichée. */
  const onMarkThreadRead = useCallback(async () => {
    if (!activeMessage) return;
    setBusy(true);
    try {
      const { updated } = await markThreadReadFn({ data: { messageId: activeMessage.id } });
      push(
        "success",
        updated === 0
          ? "Cette conversation était déjà lue."
          : `${updated} message${updated > 1 ? "s" : ""} marqué${updated > 1 ? "s" : ""} comme lu${updated > 1 ? "s" : ""}.`,
      );
      if (selectedThread) {
        setSelectedThread({
          ...selectedThread,
          messages: selectedThread.messages.map((message) => ({ ...message, read: true })),
        });
      }
      if (selected) setSelected({ ...selected, read: true });
      await refreshAll();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Marquage impossible.");
    } finally {
      setBusy(false);
    }
  }, [activeMessage, push, refreshAll, selected, selectedThread]);

  /** Après une sortie de liste (archive, corbeille) : la sélection reste utile. */
  const keepSelection = useCallback(() => {
    setActiveIndex((current) => clampIndex(current, Math.max(0, itemsRef.current.length - 1)));
  }, []);

  const onArchive = useCallback(async () => {
    if (!activeMessage) return;
    setBusy(true);
    try {
      await archiveMessageFn({ data: { messageId: activeMessage.id } });
      push("success", "Message archivé.");
      setSelected(null);
      setSelectedThread(null);
      keepSelection();
      await refreshAll();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Archivage impossible.");
    } finally {
      setBusy(false);
    }
  }, [activeMessage, keepSelection, push, refreshAll]);

  const onTrash = useCallback(async () => {
    if (!activeMessage) return;
    setBusy(true);
    try {
      await trashMessageFn({ data: { messageId: activeMessage.id } });
      setSelected(null);
      setSelectedThread(null);
      keepSelection();
      await refreshAll();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Mise à la corbeille impossible.");
    } finally {
      setBusy(false);
    }
  }, [activeMessage, keepSelection, push, refreshAll]);

  const onRestore = useCallback(async () => {
    if (!activeMessage) return;
    setBusy(true);
    try {
      await restoreMessageFn({ data: { messageId: activeMessage.id } });
      setSelected(null);
      setSelectedThread(null);
      keepSelection();
      await refreshAll();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Restauration impossible.");
    } finally {
      setBusy(false);
    }
  }, [activeMessage, keepSelection, push, refreshAll]);

  const onDeleteForever = useCallback(async () => {
    if (!activeMessage) return;
    setBusy(true);
    try {
      await deleteMessageFn({ data: { messageId: activeMessage.id } });
      setConfirmDeleteForever(false);
      setSelected(null);
      setSelectedThread(null);
      keepSelection();
      await refreshAll();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }, [activeMessage, keepSelection, push, refreshAll]);

  // -------------------------------------------------------------------------
  // Raccourcis clavier
  // -------------------------------------------------------------------------

  const onShortcut = useCallback(
    (action: MailAction) => {
      switch (action) {
        case "next":
        case "previous": {
          const direction = action === "next" ? 1 : -1;
          const next = stepIndex(activeIndex, direction, itemsRef.current.length);
          if (next === null) return;
          const item = itemsRef.current[next];
          if (!item) return;
          setActiveIndex(next);
          setFocusNonce((value) => value + 1);
          // La lecture suit le curseur : inutile de valider pour voir le message.
          selectItem(item, next);
          return;
        }
        case "first":
        case "last": {
          const next =
            itemsRef.current.length === 0
              ? -1
              : action === "first"
                ? 0
                : itemsRef.current.length - 1;
          const item = itemsRef.current[next];
          if (!item) return;
          setActiveIndex(next);
          setFocusNonce((value) => value + 1);
          selectItem(item, next);
          return;
        }
        case "open": {
          const item = itemsRef.current[activeIndex];
          if (item) selectItem(item, activeIndex);
          return;
        }
        case "compose":
          openComposer();
          return;
        case "reply":
          if (activeMessage && folder !== "sent" && folder !== "drafts") {
            replyTo(activeMessage);
          }
          return;
        case "archive":
          if (folder !== "trash" && folder !== "drafts" && folder !== "archive") void onArchive();
          return;
        case "trash":
          void onTrash();
          return;
        case "star":
          if (activeMessage) void onToggleStar(activeMessage.id);
          return;
        case "close":
          if (reply) {
            closeReply();
            return;
          }
          setSelected(null);
          setSelectedThread(null);
          return;
        case "search":
          searchRef.current?.focus();
          searchRef.current?.select();
          return;
        case "help":
          setShowShortcuts((current) => !current);
          return;
        default:
          return;
      }
    },
    [
      activeIndex,
      activeMessage,
      closeReply,
      folder,
      onArchive,
      onTrash,
      onToggleStar,
      openComposer,
      reply,
      replyTo,
      selectItem,
    ],
  );

  const modalOpen = composer !== null || confirmDeleteForever || showShortcuts || showLabels;

  useMailShortcuts(onShortcut, { modalOpen });

  const folderEntries = useMemo(() => Object.keys(FOLDER_LABELS) as FolderKey[], []);

  const labelEntries = useMemo(
    () =>
      labels.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
        total: labelCounts[label.id]?.total ?? 0,
        unread: labelCounts[label.id]?.unread ?? 0,
      })),
    [labels, labelCounts],
  );

  const unreadThread = selectedThread
    ? selectedThread.messages.filter((message) => !message.read).length
    : 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader
        title="Mail"
        description={address ? `Boîte de ${address}` : undefined}
        actions={
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={sidebarOpen}
              aria-label={sidebarOpen ? "Masquer les dossiers" : "Afficher les dossiers"}
              title={sidebarOpen ? "Masquer les dossiers" : "Afficher les dossiers"}
              onClick={() => setSidebarOpen((open) => !open)}
            >
              Dossiers
            </Button>
            <Button size="sm" onClick={() => openComposer()}>
              Écrire
            </Button>
            <Menu
              label="Actions de la boîte"
              align="end"
              triggerIcon={<span aria-hidden>⋯</span>}
              triggerClassName="h-8 w-8 border-transparent bg-transparent px-0 hover:bg-muted focus-visible:ring-offset-0"
              items={[
                {
                  id: "shortcuts",
                  label: "Raccourcis clavier",
                  shortcut: "?",
                  onSelect: () => setShowShortcuts(true),
                },
                {
                  id: "manage-labels",
                  label: "Gérer les libellés…",
                  onSelect: () => setShowLabels(true),
                },
                {
                  id: "refresh",
                  label: "Actualiser",
                  separated: true,
                  onSelect: () => void refreshAll(),
                },
              ]}
            />
          </div>
        }
      />

      <FilterBar
        inputRef={searchRef}
        filters={filters}
        resultCount={items.length}
        labels={labels}
        onChange={setFilters}
      />

      <div className="flex min-h-0 flex-1 gap-3">
        {sidebarOpen ? (
          <aside className="flex w-52 shrink-0 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-1">
              <p className="min-w-0 truncate text-xs text-muted-foreground" title={address}>
                {address || "…"}
              </p>
              <button
                type="button"
                aria-label="Fermer les dossiers"
                title="Fermer les dossiers"
                onClick={() => setSidebarOpen(false)}
                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <nav aria-label="Dossiers" className="flex flex-col gap-1">
              {folderEntries.map((key) => {
                const counts = folders?.[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setFolder(key);
                      setActiveIndex(-1);
                      setSelected(null);
                      setSelectedThread(null);
                      setReply(null);
                      setReplyBody("");
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                      key === folder ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                  >
                    <span className="truncate">{FOLDER_LABELS[key]}</span>
                    <span className="ml-auto flex items-center gap-1">
                      {counts && counts.unread > 0 ? <Badge>{counts.unread}</Badge> : null}
                      <span className="text-xs text-muted-foreground">{counts?.total ?? ""}</span>
                    </span>
                  </button>
                );
              })}
            </nav>

            <LabelsPanel
              labels={labelEntries}
              activeLabelId={filters.labelId}
              onSelect={(labelId) => setFilters({ ...filters, labelId })}
              onManage={() => setShowLabels(true)}
            />
          </aside>
        ) : null}

        <section className="flex w-80 shrink-0 flex-col rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border p-2">
            <SegmentedTabs
              ariaLabel="Affichage"
              items={VIEW_TABS}
              value={mode}
              onChange={(next) => {
                setMode(next);
                setActiveIndex(-1);
                setSelected(null);
                setSelectedThread(null);
                setExpandedKey(null);
                setExpandedMessages(null);
                setReply(null);
                setReplyBody("");
              }}
            />
          </div>
          <MessageList
            items={items}
            selectedKey={selectedKey}
            folder={folder}
            activeIndex={activeIndex}
            focusNonce={focusNonce}
            loading={loading}
            empty={
              <MessageListEmpty
                title={mode === "conversations" ? "Aucune conversation." : "Aucun message."}
                hint={
                  filters.labelId
                    ? "Aucun message ne porte ce libellé dans ce dossier."
                    : EMPTY_HINTS[folder]
                }
                action={
                  <Button size="sm" variant="outline" onClick={() => openComposer()}>
                    Écrire un message
                  </Button>
                }
              />
            }
            onSelect={(item, index) => selectItem(item, index)}
            expandedKey={mode === "conversations" ? expandedKey : null}
            expandedMessages={expandedMessages}
            onToggleExpand={(item) => void toggleExpand(item)}
            onExpandMessage={(messageId) => void openMessage(messageId)}
            onStarMessage={(messageId) => void onToggleStar(messageId)}
          />
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
                    {threadLatest?.labels.length ? " ·" : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {threadLatest?.labels.map((label) => (
                      <LabelChip key={label.id} label={label} />
                    ))}
                  </div>
                </div>
                {threadLatest ? (
                  <ReadingActions
                    folder={folder}
                    starred={threadLatest.starred}
                    busy={busy}
                    unread={unreadThread}
                    appliedLabelIds={threadLatest.labels.map((label) => label.id)}
                    allLabels={labels}
                    onToggleStar={() => void onToggleStar(threadLatest.id)}
                    onReply={(mode) => replyTo(threadLatest, mode)}
                    onEditDraft={() =>
                      openComposer({
                        id: threadLatest.id,
                        to: [...threadLatest.toAddresses],
                        cc: [...threadLatest.ccAddresses],
                        bcc: [...threadLatest.bccAddresses],
                        subject: threadLatest.subject,
                        body: threadLatest.body,
                      })
                    }
                    onArchive={() => void onArchive()}
                    onTrash={() => void onTrash()}
                    onRestore={() => void onRestore()}
                    onDeleteForever={() => setConfirmDeleteForever(true)}
                    onMarkRead={() => void onMarkThreadRead()}
                    onToggleLabel={(labelId) =>
                      toggleMessageLabel(
                        threadLatest.id,
                        threadLatest.labels.map((label) => label.id),
                        labelId,
                      )
                    }
                    onManageLabels={() => setShowLabels(true)}
                  />
                ) : null}
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
                          {message.bccAddresses.length > 0
                            ? ` · Cci : ${message.bccAddresses.join(", ")}`
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
              {reply ? (
                <ReplyEditor
                  reply={reply}
                  body={replyBody}
                  busy={replyBusy}
                  onBodyChange={setReplyBody}
                  onClose={closeReply}
                  onExpand={expandReply}
                  onSend={() => void sendReply()}
                />
              ) : null}
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
                    {selected.bccAddresses.length > 0
                      ? ` · Cci : ${selected.bccAddresses.join(", ")}`
                      : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {selected.labels.map((label) => (
                      <LabelChip key={label.id} label={label} />
                    ))}
                  </div>
                  {selected.sendError ? (
                    <p className="mt-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                      {selected.sendError}
                    </p>
                  ) : null}
                </div>
                <ReadingActions
                  folder={folder}
                  starred={selected.starred}
                  busy={busy}
                  unread={0}
                  appliedLabelIds={selected.labels.map((label) => label.id)}
                  allLabels={labels}
                  onToggleStar={() => void onToggleStar(selected.id)}
                  onReply={(mode) => replyTo(selected, mode)}
                  onEditDraft={() =>
                    openComposer({
                      id: selected.id,
                      to: [...selected.toAddresses],
                      cc: [...selected.ccAddresses],
                      bcc: [...selected.bccAddresses],
                      subject: selected.subject,
                      body: selected.body,
                    })
                  }
                  onArchive={() => void onArchive()}
                  onTrash={() => void onTrash()}
                  onRestore={() => void onRestore()}
                  onDeleteForever={() => setConfirmDeleteForever(true)}
                  onToggleLabel={(labelId) =>
                    toggleMessageLabel(
                      selected.id,
                      selected.labels.map((label) => label.id),
                      labelId,
                    )
                  }
                  onManageLabels={() => setShowLabels(true)}
                />
              </header>
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
                <div className="whitespace-pre-wrap text-sm">
                  {selected.body || "(message vide)"}
                </div>
                <AttachmentLinks attachments={selected.attachments} />
              </div>
              {reply ? (
                <ReplyEditor
                  reply={reply}
                  body={replyBody}
                  busy={replyBusy}
                  onBodyChange={setReplyBody}
                  onClose={closeReply}
                  onExpand={expandReply}
                  onSend={() => void sendReply()}
                />
              ) : null}
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="text-muted-foreground [&_svg]:size-5">
                  <IconMail />
                </span>
                <p className="text-sm text-muted-foreground">
                  {mode === "conversations"
                    ? "Sélectionnez une conversation."
                    : "Sélectionnez un message."}
                </p>
                <p className="text-xs text-muted-foreground">
                  {items.length > 0
                    ? "Astuce : j et k pour parcourir, n pour écrire, e pour archiver."
                    : "Appuyez sur n pour écrire un message."}
                </p>
                <button
                  type="button"
                  onClick={() => setShowShortcuts(true)}
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  Voir tous les raccourcis
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <Toasts toasts={toasts} dismiss={dismiss} />

      {composer ? (
        <ComposerDialog
          seed={composer}
          onClose={() => setComposer(null)}
          onSent={onSent}
          onDraftSaved={onDraftSaved}
          onError={onComposerError}
        />
      ) : null}

      <ShortcutsHelp open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      <ManageLabelsDialog
        open={showLabels}
        onClose={() => setShowLabels(false)}
        labels={labels}
        onChanged={() => void refreshLabels()}
        onError={(message) => push("danger", message)}
      />

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

/** Pied de lecture : la réponse se rédige et s'envoie en place. */
function ReplyEditor({
  reply,
  body,
  busy,
  onBodyChange,
  onClose,
  onExpand,
  onSend,
}: {
  reply: ReplyDraft;
  body: string;
  busy: boolean;
  onBodyChange: (value: string) => void;
  onClose: () => void;
  onExpand: () => void;
  onSend: () => void;
}) {
  return (
    <form
      className="flex flex-col gap-2 border-t border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">À : {reply.to.join(", ")}</span>
        {reply.cc.length > 0 ? (
          <span className="min-w-0 truncate">Cc : {reply.cc.join(", ")}</span>
        ) : null}
        <span className="ml-auto max-w-full truncate">{reply.subject}</span>
      </div>
      <textarea
        aria-label="Votre réponse"
        value={body}
        rows={6}
        maxLength={100_000}
        disabled={busy}
        // biome-ignore lint/a11y/noAutofocus: réponse rédigée en place, le champ prend le focus.
        autoFocus
        onChange={(event) => onBodyChange(event.target.value)}
        className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-soft"
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          Le message d'origine est cité sous votre réponse.
        </span>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={onExpand}
          title="Ouvrir dans le compositeur (Cci, pièces jointes)"
        >
          Ouvrir dans le compositeur
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          title="Fermer (Échap)"
          onClick={onClose}
        >
          Fermer
        </Button>
        <Button type="submit" loading={busy}>
          Envoyer
        </Button>
      </div>
    </form>
  );
}

/** Menu des libellés d'un message : coche appliquée, bascule immédiate. */
function LabelsMenu({
  appliedLabelIds,
  allLabels,
  onToggle,
  onManage,
}: {
  appliedLabelIds: string[];
  allLabels: MailLabel[];
  onToggle: (labelId: string) => void;
  onManage: () => void;
}) {
  const applied = new Set(appliedLabelIds);
  const items: MenuItem[] = allLabels.map((label) => ({
    id: label.id,
    label: `${applied.has(label.id) ? "✓ " : ""}${label.name}`,
    onSelect: () => onToggle(label.id),
  }));
  items.push({
    id: "manage-labels",
    label: allLabels.length > 0 ? "Gérer les libellés…" : "Créer un libellé…",
    separated: allLabels.length > 0,
    onSelect: onManage,
  });
  return (
    <Menu
      label="Libellés"
      align="end"
      triggerClassName="h-8 border-transparent bg-transparent px-2 hover:bg-muted focus-visible:ring-offset-0"
      items={items}
    />
  );
}

type ReadingActionsProps = {
  folder: FolderKey;
  starred: boolean;
  busy: boolean;
  /** Messages non lus du fil — 0 pour un message seul. */
  unread: number;
  /** Libellés appliqués au message lu. */
  appliedLabelIds: string[];
  allLabels: MailLabel[];
  onToggleStar: () => void;
  onReply: (mode: "reply" | "replyAll") => void;
  onEditDraft?: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onMarkRead?: () => void;
  onToggleLabel: (labelId: string) => void;
  onManageLabels: () => void;
};

/**
 * Actions du message lu — gestes fréquents en boutons `ghost` (suivre,
 * répondre, archiver, libellés), le reste replié dans le menu « ⋯ ».
 */
function ReadingActions({
  folder,
  starred,
  busy,
  unread,
  appliedLabelIds,
  allLabels,
  onToggleStar,
  onReply,
  onEditDraft,
  onArchive,
  onTrash,
  onRestore,
  onDeleteForever,
  onMarkRead,
  onToggleLabel,
  onManageLabels,
}: ReadingActionsProps) {
  const canReply = folder !== "sent" && folder !== "drafts";
  const canArchive = folder !== "trash" && folder !== "drafts" && folder !== "archive";

  const rare: MenuItem[] = [];
  if (unread > 0 && onMarkRead) {
    rare.push({
      id: "mark-read",
      label: "Tout marquer comme lu",
      disabled: busy,
      onSelect: onMarkRead,
    });
  }
  if (folder === "trash") {
    rare.push({
      id: "restore",
      label: "Restaurer",
      separated: rare.length > 0,
      disabled: busy,
      onSelect: onRestore,
    });
    rare.push({
      id: "delete-forever",
      label: "Supprimer définitivement",
      separated: true,
      destructive: true,
      disabled: busy,
      onSelect: onDeleteForever,
    });
  } else if (folder === "archive") {
    rare.push({
      id: "restore",
      label: "Remettre dans son dossier",
      separated: rare.length > 0,
      disabled: busy,
      onSelect: onRestore,
    });
    rare.push({
      id: "trash",
      label: "Mettre à la corbeille",
      separated: true,
      destructive: true,
      disabled: busy,
      onSelect: onTrash,
    });
  } else {
    rare.push({
      id: "trash",
      label: "Mettre à la corbeille",
      shortcut: "Suppr",
      separated: rare.length > 0,
      destructive: true,
      disabled: busy,
      onSelect: onTrash,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        aria-label={starred ? "Retirer le suivi" : "Suivre"}
        onClick={onToggleStar}
      >
        {starred ? "★" : "☆"}
      </Button>
      {canReply ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => onReply("reply")}>
            Répondre
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onReply("replyAll")}>
            Répondre à tous
          </Button>
        </>
      ) : null}
      {folder === "drafts" && onEditDraft ? (
        <Button size="sm" variant="ghost" onClick={onEditDraft}>
          Modifier le brouillon
        </Button>
      ) : null}
      {canArchive ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onArchive}>
          Archiver
        </Button>
      ) : null}
      <LabelsMenu
        appliedLabelIds={appliedLabelIds}
        allLabels={allLabels}
        onToggle={onToggleLabel}
        onManage={onManageLabels}
      />
      <Menu
        label="Actions du message"
        align="end"
        triggerIcon={<span aria-hidden>⋯</span>}
        triggerClassName="h-8 w-8 border-transparent bg-transparent px-0 hover:bg-muted focus-visible:ring-offset-0"
        items={rare}
      />
    </div>
  );
}

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
              className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
            >
              <PaperclipGlyph />
              <span className="min-w-0 truncate">{attachment.filename}</span>{" "}
              <span className="text-xs text-muted-foreground">
                ({formatFileSize(attachment.sizeBytes)})
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
