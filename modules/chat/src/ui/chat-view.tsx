import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Input,
  Label,
  SegmentedTabs,
  Toasts,
  useToasts,
} from "@workspace/ui";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type AttachmentToken,
  archiveChannelFn,
  type ChannelView,
  type ChannelVisibility,
  createChannelFn,
  getUnreadStateFn,
  type JoinableChannelView,
  joinChannelFn,
  listChannelsFn,
  listJoinableChannelsFn,
  listMessagesFn,
  listOrgMembersFn,
  listPinsFn,
  type MessageView,
  markReadFn,
  type OrgMemberView,
  type PinView,
  pinMessageFn,
  restoreChannelFn,
  sendMessageFn,
  startDmFn,
  unpinMessageFn,
  uploadChatAttachmentFn,
} from "../server.ts";
import { ChannelHeader } from "./channel-header.tsx";
import { ChannelSidebar } from "./channel-sidebar.tsx";
import { DiscoverDialog } from "./discover-dialog.tsx";
import { fmtSize } from "./format.ts";
import { MembersDialog } from "./members-dialog.tsx";
import { MessageList } from "./message-list.tsx";
import { PinsDialog } from "./pins-dialog.tsx";

/** Bornes du compositeur, alignées sur le serveur : 5 fichiers de 10 Mo. */
const COMPOSER_MAX_ATTACHMENTS = 5;
const COMPOSER_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

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

/** Lots d'un événement SSE `messages` : données JSON non fiables, jamais de throw. */
function parseMessageRows(raw: string): MessageView[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MessageView[]) : [];
  } catch {
    return [];
  }
}

/**
 * Chat — canaux d'organisation et discussions directes. Temps réel par
 * Server-Sent Events (`/api/chat/stream`) avec repli automatique sur
 * l'interrogation courte (2,5 s) si le flux échoue ; la liste des canaux reste
 * rafraîchie toutes les 5 s.
 *
 * Trois conforts structurent la lecture : le séparateur de messages non lus
 * (borne lue avant le marquage), les épingles (panneau dédié, épingle sur chaque
 * message) et la gestion des canaux (privés, archivage, membres visibles).
 */
export function ChatView() {
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [input, setInput] = useState("");
  /** Jetons d'upload en attente de rattachement à l'envoi. */
  const [attachments, setAttachments] = useState<AttachmentToken[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [channelDialog, setChannelDialog] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelVisibility, setChannelVisibility] = useState<ChannelVisibility>("public");
  const [dmDialog, setDmDialog] = useState(false);
  const [orgMembers, setOrgMembers] = useState<OrgMemberView[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const { toasts, push, dismiss } = useToasts();
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Transport temps réel : SSE tant qu'il fonctionne, sinon interrogation. */
  const [useSse, setUseSse] = useState(true);
  const previousChannelRef = useRef<string | null>(null);

  // --- Séparateur de non-lus -------------------------------------------------
  /** Curseur de lecture au moment de l'ouverture : tout ce qui suit est nouveau. */
  const [unreadCutoff, setUnreadCutoff] = useState<string | null>(null);

  // --- Épingles --------------------------------------------------------------
  const [pins, setPins] = useState<PinView[]>([]);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [pinsError, setPinsError] = useState<string | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pinPendingId, setPinPendingId] = useState<string | null>(null);

  /** Identifiants des messages épinglés — marque sur la bulle. */
  const pinnedIds = new Set(pins.map((pin) => pin.messageId));

  // --- Membres et découverte -------------------------------------------------
  const [membersOpen, setMembersOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [joinable, setJoinable] = useState<JoinableChannelView[]>([]);
  const [joinableLoading, setJoinableLoading] = useState(false);
  const [joinableError, setJoinableError] = useState<string | null>(null);

  // --- Archivage -------------------------------------------------------------
  const [archiveTarget, setArchiveTarget] = useState<ChannelView | null>(null);

  /** Region aria-live : le dernier message reçu d'autrui, jamais les nôtres. */
  const [announcement, setAnnouncement] = useState("");
  /** Dernier identifiant déjà annoncé — évite les répétitions au rendu. */
  const announcedIdRef = useRef<string | null>(null);
  /** Vrai une fois la liste initiale chargée : avant, rien à annoncer. */
  const warmRef = useRef(false);

  const refreshChannels = useCallback(async () => {
    try {
      const list = await listChannelsFn();
      setChannels(list);
      setActiveId((current) =>
        current && list.some((channel) => channel.id === current) ? current : (list[0]?.id ?? null),
      );
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void refreshChannels();
    const interval = setInterval(() => void refreshChannels(), 5000);
    return () => clearInterval(interval);
  }, [refreshChannels]);

  const refreshMessages = useCallback(async (channelId: string) => {
    try {
      const list = await listMessagesFn({ data: { channelId } });
      setMessages(list);
    } catch {
      // silencieux pendant l'interrogation
    }
  }, []);

  /**
   * Épingles de la conversation. `silent` sert aux relectures après une action :
   * l'erreur vient d'être signalée par un toast, inutile de basculer le panneau
   * en état d'erreur par-dessus.
   */
  const loadPins = useCallback(async (channelId: string, silent: boolean) => {
    if (!silent) {
      setPinsLoading(true);
      setPinsError(null);
    }
    try {
      setPins(await listPinsFn({ data: { channelId } }));
    } catch (caught) {
      setPins([]);
      if (!silent) {
        setPinsError(
          caught instanceof Error ? caught.message : "Chargement des épingles impossible.",
        );
      }
    } finally {
      if (!silent) setPinsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeId) {
      setPins([]);
      setPinsError(null);
      return;
    }
    void loadPins(activeId, false);
  }, [activeId, loadPins]);

  useEffect(() => {
    if (!activeId) {
      previousChannelRef.current = null;
      warmRef.current = false;
      announcedIdRef.current = null;
      setMessages([]);
      setUnreadCutoff(null);
      return;
    }
    // Nouvelle conversation : les annonces repartent de zéro (le premier
    // chargement ne doit rien énoncer, l'utilisateur vient d'arriver).
    warmRef.current = false;
    // Changement de canal : on retente SSE (le précédent a pu échouer).
    if (previousChannelRef.current !== activeId) {
      previousChannelRef.current = activeId;
      if (!useSse) {
        setUseSse(true);
        return;
      }
    }

    let cancelled = false;
    let source: EventSource | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const markReadNow = () => {
      void markReadFn({ data: { channelId: activeId } })
        .then(() => refreshChannels())
        .catch(() => undefined);
    };

    void (async () => {
      let initial: MessageView[] = [];
      try {
        initial = await listMessagesFn({ data: { channelId: activeId } });
        if (!cancelled) setMessages(initial);
      } catch {
        // silencieux pendant l'interrogation
      }
      // La borne des non-lus se lit AVANT le marquage : `markRead` avance le
      // curseur, le séparateur n'aurait plus rien à séparer.
      try {
        const state = await getUnreadStateFn({ data: { channelId: activeId } });
        if (!cancelled) setUnreadCutoff(state.cutoff);
      } catch {
        if (!cancelled) setUnreadCutoff(null);
      }
      if (cancelled) return;
      const lastInitial = initial[initial.length - 1];
      announcedIdRef.current = lastInitial ? lastInitial.id : null;
      warmRef.current = true;
      markReadNow();

      // Repli : sans SSE (navigateur ou flux en échec), interrogation courte.
      if (!useSse || typeof EventSource === "undefined") {
        interval = setInterval(() => void refreshMessages(activeId), 2500);
        return;
      }

      // Curseur `(created_at, id)` du dernier message connu : le flux ne
      // rediffuse que ce qui suit.
      const last = initial[initial.length - 1];
      const query = new URLSearchParams({ channelId: activeId });
      if (last) {
        query.set("since", last.createdAt);
        query.set("sinceId", last.id);
      }
      const nextSource = new EventSource(`/api/chat/stream?${query.toString()}`);
      source = nextSource;
      nextSource.addEventListener("messages", (event) => {
        const rows = parseMessageRows((event as MessageEvent<string>).data);
        if (rows.length === 0) return;
        setMessages((current) => {
          // Déduplication par identifiant : les échos de nos propres envois
          // sont déjà dans la liste.
          const known = new Set(current.map((message) => message.id));
          const fresh = rows.filter((row) => !known.has(row.id));
          return fresh.length === 0 ? current : [...current, ...fresh];
        });
        if (document.visibilityState === "visible") markReadNow();
      });
      nextSource.onerror = () => {
        // Flux refusé ou coupé : on ferme et on repasse à l'interrogation ;
        // le prochain canal retentera SSE.
        nextSource.close();
        setUseSse(false);
      };
    })();

    return () => {
      cancelled = true;
      source?.close();
      if (interval !== null) clearInterval(interval);
    };
  }, [activeId, refreshChannels, refreshMessages, useSse]);

  // Changement de conversation : un jeton téléversé ne suit jamais un autre
  // canal — il est oublié (le blob reste, orphelin, nettoyé hors ligne).
  // biome-ignore lint/correctness/useExhaustiveDependencies: remise à zéro à chaque changement de canal.
  useEffect(() => {
    setAttachments([]);
  }, [activeId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: défilement vers le bas à chaque nouveau message.
  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  /**
   * Annonce des nouveaux messages d'autrui. Volontairement « polite » : le
   * lecteur d'écran lit quand l'utilisateur est prêt, et le focus n'est jamais
   * déplacé (il reste dans le compositeur pendant la saisie).
   */
  useEffect(() => {
    if (!warmRef.current) return;
    const last = messages[messages.length - 1];
    if (!last || last.mine) return;
    if (announcedIdRef.current === last.id) return;
    announcedIdRef.current = last.id;
    setAnnouncement(`Nouveau message de ${last.authorName} : ${last.body}`);
  }, [messages]);

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = input.trim();
    if (body.length === 0 || !activeId) return;
    setBusy(true);
    try {
      const sent = await sendMessageFn({
        data: {
          channelId: activeId,
          body,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
      });
      setInput("");
      setAttachments([]);
      setMessages((current) => [...current, sent]);
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
    if (files.length === 0) return;

    const remaining = COMPOSER_MAX_ATTACHMENTS - attachments.length;
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

    setUploading(true);
    try {
      let updated = attachments;
      for (const file of files.slice(0, remaining)) {
        if (file.size > COMPOSER_MAX_ATTACHMENT_BYTES) {
          push("danger", `« ${file.name} » dépasse 10 Mo.`);
          continue;
        }
        try {
          const contentBase64 = await fileToBase64(file);
          const token = await uploadChatAttachmentFn({
            data: {
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              contentBase64,
            },
          });
          updated = [...updated, token];
          setAttachments(updated);
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
      setUploading(false);
    }
  }

  function removeAttachment(storageKey: string) {
    setAttachments((current) => current.filter((token) => token.storageKey !== storageKey));
  }

  async function onCreateChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (channelName.trim().length === 0) return;
    setBusy(true);
    try {
      const created = await createChannelFn({
        data: { name: channelName.trim(), visibility: channelVisibility },
      });
      const createdName = channelName.trim();
      setChannelName("");
      setChannelVisibility("public");
      setChannelDialog(false);
      await refreshChannels();
      setActiveId(created.id);
      push(
        "success",
        channelVisibility === "private"
          ? `Canal privé « ${createdName} » créé — invitez vos membres.`
          : `Canal « ${createdName} » créé.`,
      );
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Création impossible.");
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
      push("danger", caught instanceof Error ? caught.message : "Discussion impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onTogglePin(message: MessageView) {
    if (!activeId) return;
    setPinPendingId(message.id);
    try {
      if (pinnedIds.has(message.id)) {
        await unpinMessageFn({ data: { channelId: activeId, messageId: message.id } });
      } else {
        await pinMessageFn({ data: { channelId: activeId, messageId: message.id } });
      }
      await loadPins(activeId, true);
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Épingle impossible.");
    } finally {
      setPinPendingId(null);
    }
  }

  async function onUnpin(pin: PinView) {
    if (!activeId) return;
    try {
      await unpinMessageFn({ data: { channelId: activeId, messageId: pin.messageId } });
      await loadPins(activeId, true);
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Désépinglage impossible.");
    }
  }

  async function openDiscover() {
    setDiscoverOpen(true);
    setJoinableLoading(true);
    setJoinableError(null);
    try {
      setJoinable(await listJoinableChannelsFn());
    } catch (caught) {
      setJoinableError(
        caught instanceof Error ? caught.message : "Recherche des canaux impossible.",
      );
    } finally {
      setJoinableLoading(false);
    }
  }

  async function onJoin(channelId: string) {
    setBusy(true);
    try {
      await joinChannelFn({ data: { channelId } });
      await refreshChannels();
      setDiscoverOpen(false);
      setActiveId(channelId);
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Adhésion impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onArchiveConfirmed() {
    if (!archiveTarget) return;
    setBusy(true);
    try {
      await archiveChannelFn({ data: { channelId: archiveTarget.id } });
      push("success", `Canal « ${archiveTarget.name} » archivé.`);
      setArchiveTarget(null);
      await refreshChannels();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Archivage impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(channel: ChannelView) {
    setBusy(true);
    try {
      await restoreChannelFn({ data: { channelId: channel.id } });
      push("success", `Canal « ${channel.name} » désarchivé.`);
      await refreshChannels();
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Désarchivage impossible.");
    } finally {
      setBusy(false);
    }
  }

  const active = channels.find((channel) => channel.id === activeId) ?? null;

  // Pas de PageHeader : Chat est un shell à deux panneaux pleine hauteur, un
  // en-tête de page volerait l'espace vertical de la conversation ; le h1
  // compact de la barre latérale reste le titre de la page.
  return (
    <div className="mx-auto flex h-full min-h-0 max-w-6xl gap-4">
      <ChannelSidebar
        channels={channels}
        activeId={activeId}
        loading={loading}
        onSelect={setActiveId}
        onCreateChannel={() => setChannelDialog(true)}
        onStartDm={() => void openDmDialog()}
        onDiscover={() => void openDiscover()}
      />

      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
        {active ? (
          <>
            <ChannelHeader
              channel={active}
              pinCount={pins.length}
              onOpenPins={() => setPinsOpen(true)}
              onOpenMembers={() => setMembersOpen(true)}
              onArchive={() => setArchiveTarget(active)}
              onRestore={() => void onRestore(active)}
              busy={busy}
            />

            <MessageList
              messages={messages}
              pinnedIds={pinnedIds}
              pinPendingId={pinPendingId}
              onTogglePin={(message) => void onTogglePin(message)}
              unreadCutoff={unreadCutoff}
              announcement={announcement}
              scrollRef={scrollRef}
            />

            {active.archived ? (
              <p className="border-t border-border p-4 text-sm text-muted-foreground">
                Ce canal est archivé : l'envoi de messages est désactivé. Son historique reste
                consultable.
              </p>
            ) : (
              <form
                onSubmit={onSend}
                method="post"
                className="flex flex-col gap-2 border-t border-border p-3"
              >
                {attachments.length > 0 ? (
                  <ul aria-label="Pièces jointes en attente" className="flex flex-wrap gap-1">
                    {attachments.map((attachment) => (
                      <li
                        key={attachment.storageKey}
                        className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
                      >
                        <span className="max-w-52 truncate" title={attachment.filename}>
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
                <div className="flex items-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Pièces jointes"
                    title="Pièces jointes (5 max, 10 Mo chacune)"
                    disabled={uploading || busy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📎
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    aria-label="Pièces jointes"
                    className="hidden"
                    onChange={(event) => void onPickAttachments(event)}
                  />
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
                  <Button
                    type="submit"
                    loading={busy}
                    disabled={input.trim().length === 0 || uploading}
                  >
                    Envoyer
                  </Button>
                </div>
              </form>
            )}
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-6">
            <EmptyState
              title="Aucune conversation sélectionnée"
              hint="Choisissez une conversation dans la barre latérale, créez un canal ou rejoignez un canal public."
            />
          </div>
        )}
      </section>

      <Toasts toasts={toasts} dismiss={dismiss} />

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
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Visibilité</span>
            <SegmentedTabs
              ariaLabel="Visibilité du canal"
              value={channelVisibility}
              onChange={setChannelVisibility}
              items={[
                { id: "public", label: "Public" },
                { id: "private", label: "Privé" },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {channelVisibility === "private"
                ? "Seules les personnes invitées voient ce canal, ses membres et ses messages."
                : "Toute l'organisation peut trouver ce canal et le rejoindre."}
            </p>
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

      <MembersDialog
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        channelId={activeId}
        channelName={active?.name ?? ""}
        privateChannel={active?.kind === "channel" && active.visibility === "private"}
        canInvite={Boolean(active?.managedByMe && active.kind === "channel" && !active.archived)}
        onInvited={() => void refreshChannels()}
      />

      <PinsDialog
        open={pinsOpen}
        onClose={() => setPinsOpen(false)}
        channelName={active?.name ?? ""}
        pins={pins}
        loading={pinsLoading}
        error={pinsError}
        onRetry={() => {
          if (activeId) void loadPins(activeId, false);
        }}
        onUnpin={(pin) => void onUnpin(pin)}
        busy={false}
      />

      <DiscoverDialog
        open={discoverOpen}
        onClose={() => setDiscoverOpen(false)}
        channels={joinable}
        loading={joinableLoading}
        error={joinableError}
        onRetry={() => void openDiscover()}
        onJoin={(channelId) => void onJoin(channelId)}
        busy={busy}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => void onArchiveConfirmed()}
        title="Archiver ce canal ?"
        message={`« ${archiveTarget?.name ?? ""} » restera lisible mais n'acceptera plus de nouveau message. Vous pourrez le désarchiver à tout moment.`}
        confirmLabel="Archiver"
        busy={busy}
      />
    </div>
  );
}
