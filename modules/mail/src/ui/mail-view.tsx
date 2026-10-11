import { Badge, Button, cn, Dialog, Input, Label } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteMessageFn,
  type FolderCounts,
  type FolderKey,
  getMailboxFn,
  getMessageFn,
  listFoldersFn,
  listMessagesFn,
  type MessageDetail,
  type MessageSummary,
  restoreMessageFn,
  saveDraftFn,
  sendMailFn,
  toggleStarFn,
  trashMessageFn,
} from "../server.ts";

const FOLDER_LABELS: Record<FolderKey, string> = {
  inbox: "Boîte de réception",
  sent: "Envoyés",
  drafts: "Brouillons",
  trash: "Corbeille",
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

type Composer = {
  id?: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
};

/**
 * Mail — boîtes locales par utilisateur, dossiers, recherche, brouillons et
 * envoi (SMTP optionnel, l'échec est toujours visible sur le message).
 */
export function MailView() {
  const [address, setAddress] = useState("");
  const [folders, setFolders] = useState<FolderCounts | null>(null);
  const [folder, setFolder] = useState<FolderKey>("inbox");
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshFolders = useCallback(async () => {
    setFolders(await listFoldersFn());
  }, []);

  const refreshList = useCallback(async () => {
    const list = await listMessagesFn({
      data: { folder, query, unreadOnly, starredOnly },
    });
    setMessages(list);
  }, [folder, query, unreadOnly, starredOnly]);

  useEffect(() => {
    void (async () => {
      try {
        const mailbox = await getMailboxFn();
        setAddress(mailbox.address);
        await refreshFolders();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Chargement impossible.");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshFolders]);

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
      setError(caught instanceof Error ? caught.message : "Ouverture impossible.");
    }
  }

  function openComposer(base?: Partial<Composer>) {
    setComposer({ to: "", cc: "", subject: "", body: "", ...base });
  }

  function reply() {
    if (!selected) return;
    const subject = selected.subject.startsWith("Re:")
      ? selected.subject
      : `Re: ${selected.subject}`;
    openComposer({
      to: selected.fromAddress,
      subject,
      body: `\n\n— ${selected.fromName ?? selected.fromAddress} a écrit :\n> ${selected.body.replaceAll("\n", "\n> ")}`,
    });
  }

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!composer) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendMailFn({
        data: {
          id: composer.id,
          to: splitAddresses(composer.to),
          cc: splitAddresses(composer.cc),
          subject: composer.subject,
          body: composer.body,
        },
      });
      if (result.sendError) {
        setError(result.sendError);
      }
      setComposer(null);
      setFolder("sent");
      setSelected(null);
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveDraft() {
    if (!composer) return;
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
      setError(caught instanceof Error ? caught.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleStar(messageId: string) {
    await toggleStarFn({ data: { messageId } });
    await refreshAll();
    if (selected?.id === messageId) {
      setSelected(await getMessageFn({ data: { messageId } }));
    }
  }

  async function onTrash() {
    if (!selected) return;
    setBusy(true);
    try {
      await trashMessageFn({ data: { messageId: selected.id } });
      setSelected(null);
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function onRestore() {
    if (!selected) return;
    setBusy(true);
    try {
      await restoreMessageFn({ data: { messageId: selected.id } });
      setSelected(null);
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteForever() {
    if (!selected) return;
    setBusy(true);
    try {
      await deleteMessageFn({ data: { messageId: selected.id } });
      setSelected(null);
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  const folderEntries = useMemo(() => Object.keys(FOLDER_LABELS) as FolderKey[], []);

  return (
    <div className="mx-auto flex h-[calc(100vh-8.5rem)] max-w-6xl gap-3">
      <aside className="flex w-52 shrink-0 flex-col gap-3 rounded-xl border border-border bg-card p-3">
        <Button size="sm" onClick={() => openComposer()}>
          Écrire
        </Button>
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
        <div className="border-b border-border p-2">
          <Input
            aria-label="Rechercher dans les messages"
            placeholder="Rechercher…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8"
          />
        </div>
        <ul className="flex flex-1 flex-col divide-y divide-border overflow-y-auto">
          {loading ? (
            <li className="p-3 text-xs text-muted-foreground">Chargement…</li>
          ) : messages.length === 0 ? (
            <li className="p-3 text-xs text-muted-foreground">Aucun message.</li>
          ) : (
            messages.map((message) => (
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
                    {message.starred ? <span className="text-attention">★</span> : null}
                    {message.sendError ? (
                      <span className="text-[10px] text-destructive" title={message.sendError}>
                        ⚠
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
        {selected ? (
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
                  <Button size="sm" variant="outline" onClick={reply}>
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
                      onClick={() => void onDeleteForever()}
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
            <div className="flex-1 overflow-y-auto whitespace-pre-wrap p-4 text-sm">
              {selected.body || "(message vide)"}
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-6">
            <p className="text-sm text-muted-foreground">Sélectionnez un message.</p>
          </div>
        )}
      </section>

      {error ? (
        <p
          role="alert"
          className="fixed bottom-4 right-4 max-w-md rounded-md border border-destructive/40 bg-card px-3 py-2 text-sm text-destructive shadow-lift"
        >
          {error}
        </p>
      ) : null}

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
    </div>
  );
}
