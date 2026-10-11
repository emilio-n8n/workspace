import { Badge, Button, cn, Dialog, Input, Label } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type ChannelView,
  createChannelFn,
  listChannelsFn,
  listMessagesFn,
  listOrgMembersFn,
  type MessageView,
  markReadFn,
  type OrgMemberView,
  sendMessageFn,
  startDmFn,
} from "../server.ts";

function fmtTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/**
 * Chat — canaux d'organisation et discussions directes. Rafraîchissement par
 * interrogation courte (2,5 s) : suffisant pour une instance auto-hébergée, le
 * passage aux WebSockets est un chantier documenté (docs/modules/chat.md).
 */
export function ChatView() {
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [channelDialog, setChannelDialog] = useState(false);
  const [dmDialog, setDmDialog] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [orgMembers, setOrgMembers] = useState<OrgMemberView[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshChannels = useCallback(async () => {
    try {
      const list = await listChannelsFn();
      setChannels(list);
      setActiveId((current) =>
        current && list.some((channel) => channel.id === current) ? current : (list[0]?.id ?? null),
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshChannels();
    const interval = setInterval(() => void refreshChannels(), 5000);
    return () => clearInterval(interval);
  }, [refreshChannels]);

  // Les erreurs disparaissent d'elles-mêmes au bout de 6 s (ou sur ✕).
  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timeout);
  }, [error]);

  const refreshMessages = useCallback(async (channelId: string) => {
    try {
      const list = await listMessagesFn({ data: { channelId } });
      setMessages(list);
    } catch {
      // silencieux pendant l'interrogation
    }
  }, []);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    void refreshMessages(activeId);
    void markReadFn({ data: { channelId: activeId } })
      .then(() => refreshChannels().catch(() => undefined))
      .catch(() => undefined);
    const interval = setInterval(() => void refreshMessages(activeId), 2500);
    return () => clearInterval(interval);
  }, [activeId, refreshMessages, refreshChannels]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: défilement vers le bas à chaque nouveau message.
  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = input.trim();
    if (body.length === 0 || !activeId) return;
    setBusy(true);
    try {
      const sent = await sendMessageFn({ data: { channelId: activeId, body } });
      setInput("");
      setMessages((current) => [...current, sent]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (channelName.trim().length === 0) return;
    setBusy(true);
    try {
      const created = await createChannelFn({ data: { name: channelName.trim() } });
      setChannelName("");
      setChannelDialog(false);
      await refreshChannels();
      setActiveId(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function loadOrgMembers() {
    setMembersLoading(true);
    setMembersError(null);
    try {
      setOrgMembers(await listOrgMembersFn());
    } catch (caught) {
      setMembersError(
        caught instanceof Error ? caught.message : "Chargement des membres impossible.",
      );
    } finally {
      setMembersLoading(false);
    }
  }

  async function openDmDialog() {
    setDmDialog(true);
    await loadOrgMembers();
  }

  async function startDm(userId: string) {
    setBusy(true);
    try {
      const dm = await startDmFn({ data: { userId } });
      setDmDialog(false);
      await refreshChannels();
      setActiveId(dm.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Discussion impossible.");
    } finally {
      setBusy(false);
    }
  }

  const active = channels.find((channel) => channel.id === activeId) ?? null;
  const unreadTotal = channels.reduce((sum, channel) => sum + channel.unreadCount, 0);

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-6xl gap-4">
      <aside className="flex min-h-0 w-64 shrink-0 flex-col gap-2 rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-1">
          <h1 className="font-display text-base font-semibold">Chat</h1>
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Nouveau canal"
              title="Nouveau canal"
              onClick={() => setChannelDialog(true)}
            >
              ＋
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Nouvelle discussion"
              title="Nouvelle discussion"
              onClick={() => void openDmDialog()}
            >
              ✉
            </Button>
          </div>
        </div>
        <div aria-live="polite" className="sr-only">
          {unreadTotal > 0
            ? `${unreadTotal} message${unreadTotal > 1 ? "s" : ""} non lu${unreadTotal > 1 ? "s" : ""}`
            : "Aucun message non lu"}
        </div>
        {loading ? (
          <p className="text-xs text-muted-foreground">Chargement…</p>
        ) : channels.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Aucune conversation. Créez un canal ou démarrez une discussion.
          </p>
        ) : (
          <ul aria-label="Conversations" className="flex flex-col gap-1 overflow-y-auto">
            {channels.map((channel) => (
              <li key={channel.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(channel.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                    channel.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                  )}
                >
                  <span className="truncate">
                    {channel.kind === "channel" ? "#" : "@"}
                    {channel.name}
                  </span>
                  {channel.unreadCount > 0 ? (
                    <Badge className="ml-auto min-w-5 justify-center">{channel.unreadCount}</Badge>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
        {active ? (
          <>
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <h2 className="font-display text-sm font-semibold">
                {active.kind === "channel" ? "#" : "@"}
                {active.name}
              </h2>
              <span className="ml-auto text-xs text-muted-foreground">
                {active.lastMessageAt
                  ? `Dernier message ${fmtTime(active.lastMessageAt)}`
                  : "Aucun message"}
              </span>
            </header>

            <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun message pour le moment — lancez la conversation.
                </p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn("flex flex-col gap-0.5", message.mine && "items-end")}
                  >
                    <span className="text-[11px] text-muted-foreground">
                      {message.authorName} · {fmtTime(message.createdAt)}
                    </span>
                    <span
                      className={cn(
                        "max-w-[75%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm",
                        message.mine
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {message.body}
                    </span>
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={onSend}
              method="post"
              className="flex items-end gap-2 border-t border-border p-3"
            >
              <textarea
                aria-label="Message"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  // Composition IME (accents, langues CJK) : Entrée valide la composition.
                  if (event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
                rows={1}
                maxLength={4000}
                placeholder="Écrire un message… (Entrée pour envoyer)"
                className="max-h-32 min-h-9 flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <Button type="submit" loading={busy} disabled={input.trim().length === 0}>
                Envoyer
              </Button>
            </form>
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-6">
            <p className="text-sm text-muted-foreground">
              Sélectionnez une conversation ou créez-en une.
            </p>
          </div>
        )}
      </section>

      {error ? (
        <div
          role="alert"
          className="fixed bottom-4 right-4 flex max-w-sm items-start gap-2 rounded-md border border-destructive/40 bg-card px-3 py-2 text-sm text-destructive shadow-lift"
        >
          <span>{error}</span>
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => setError(null)}
            className="shrink-0 rounded-sm p-0.5 leading-none opacity-70 transition-opacity hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ) : null}

      <Dialog open={channelDialog} onClose={() => setChannelDialog(false)} title="Nouveau canal">
        <form onSubmit={onCreateChannel} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-name">Nom du canal</Label>
            <Input
              id="channel-name"
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              placeholder="produit"
              maxLength={80}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setChannelDialog(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={channelName.trim().length === 0}>
              Créer le canal
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dmDialog} onClose={() => setDmDialog(false)} title="Nouvelle discussion">
        {membersLoading ? (
          <p className="text-sm text-muted-foreground">Chargement des membres…</p>
        ) : membersError ? (
          <div className="flex flex-col gap-3">
            <p role="alert" className="text-sm text-destructive">
              {membersError}
            </p>
            <div>
              <Button type="button" variant="ghost" onClick={() => void loadOrgMembers()}>
                Réessayer
              </Button>
            </div>
          </div>
        ) : orgMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun autre membre dans l'organisation pour le moment.
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {orgMembers.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startDm(member.id)}
                  className="flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="font-medium">{member.name}</span>
                  <span className="text-xs text-muted-foreground">{member.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
