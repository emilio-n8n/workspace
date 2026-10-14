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
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AttachmentToken,
  ChannelMemberView,
  ChannelView,
  ChannelVisibility,
} from "../server.ts";
import {
  archiveChannelFn,
  createChannelFn,
  getUnreadStateFn,
  type JoinableChannelView,
  joinChannelFn,
  listChannelMembersFn,
  listChannelsFn,
  listJoinableChannelsFn,
  listMessagesFn,
  listOrgMembersFn,
  listPinsFn,
  listTypingUsersFn,
  type MessageView,
  markReadFn,
  type OrgMemberView,
  type PinView,
  pinMessageFn,
  restoreChannelFn,
  sendMessageFn,
  startDmFn,
  unpinMessageFn,
} from "../server.ts";
import { pruneTypingUsers, type TypingUser } from "../typing.ts";
import { ChannelHeader } from "./channel-header.tsx";
import { ChannelSidebar } from "./channel-sidebar.tsx";
import { Composer } from "./composer.tsx";
import { DiscoverDialog } from "./discover-dialog.tsx";
import { MembersDialog } from "./members-dialog.tsx";
import type { MentionCandidate } from "./mentions.ts";
import { MessageList } from "./message-list.tsx";
import { PinsDialog } from "./pins-dialog.tsx";
import {
  EMPTY_FILTERS,
  formatResultAnnouncement,
  hasActiveFilters,
  type MatchRange,
  matchRanges,
  resultCounter,
  type SearchFilters,
  searchMessages,
  stepIndex,
} from "./search.ts";
import { SearchBar } from "./search-bar.tsx";
import { TypingIndicator } from "./typing-indicator.tsx";

/** Repli du flux SSE : interrogation des états éphémères toutes les 2,5 s. */
const TYPING_POLL_MS = 2500;

/** Lots d'un événement SSE `messages` : données JSON non fiables, jamais de throw. */
function parseMessageRows(raw: string): MessageView[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MessageView[]) : [];
  } catch {
    return [];
  }
}

/** Lots d'un événement SSE `typing` : instantané des personnes en train d'écrire. */
function parseTypingRows(raw: string): TypingUser[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const row = entry as { userId?: unknown; name?: unknown; at?: unknown };
      if (
        typeof row.userId !== "string" ||
        typeof row.name !== "string" ||
        typeof row.at !== "number"
      ) {
        return [];
      }
      return [{ userId: row.userId, name: row.name, at: row.at }];
    });
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
 * Lecture : séparateur de non-lus, épingles, mentions en puces, recherche dans
 * le canal. Écriture : compositeur à mentions autocomplétées et indicateur de
 * frappe diffusé aux autres membres connectés.
 */
export function ChatView() {
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [channelDialog, setChannelDialog] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelVisibility, setChannelVisibility] = useState<ChannelVisibility>("public");
  const [dmDialog, setDmDialog] = useState(false);
  const [orgMembers, setOrgMembers] = useState<OrgMemberView[]>([]);
  /** Annuaire de l'organisation, pour le dialogue « Nouvelle discussion ». */
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const { toasts, push, dismiss } = useToasts();
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Transport temps réel : SSE tant qu'il fonctionne, sinon interrogation. */
  const [useSse, setUseSse] = useState(true);
  const previousChannelRef = useRef<string | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

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

  // --- Membres (panneau + autocomplétion des mentions) -----------------------
  const [members, setMembers] = useState<ChannelMemberView[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);

  /** Membres du canal, prêts pour l'autocomplétion des @mentions. */
  const mentionCandidates = useMemo<MentionCandidate[]>(
    () => members.map((member) => ({ id: member.id, name: member.name, email: member.email })),
    [members],
  );

  // --- Découverte ------------------------------------------------------------
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [joinable, setJoinable] = useState<JoinableChannelView[]>([]);
  const [joinableLoading, setJoinableLoading] = useState(false);
  const [joinableError, setJoinableError] = useState<string | null>(null);

  // --- Archivage -------------------------------------------------------------
  const [archiveTarget, setArchiveTarget] = useState<ChannelView | null>(null);

  // --- Indicateur de frappe --------------------------------------------------
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  /** Table vivante des signaux reçus : l'expiration y fait le ménage. */
  const typingRef = useRef(new Map<string, TypingUser>());

  // --- Recherche -------------------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  /** Index global de la correspondance active (-1 = aucune). */
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);

  /** Région aria-live : nouveaux messages, mentions insérées, résultats. */
  const [announcement, setAnnouncement] = useState("");
  /** Dernier identifiant déjà annoncé — évite les répétitions au rendu. */
  const announcedIdRef = useRef<string | null>(null);
  /** Vrai une fois la liste initiale chargée : avant, rien à annoncer. */
  const warmRef = useRef(false);

  const active = channels.find((channel) => channel.id === activeId) ?? null;

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
   * Membres de la conversation — source unique du panneau Membres et de
   * l'autocomplétion des mentions. Un échec est signalé par le panneau ; le
   * compositeur se contente de ne plus suggérer (dégradation sûre).
   */
  const loadMembers = useCallback(async (channelId: string) => {
    setMembersLoading(true);
    try {
      setMembers(await listChannelMembersFn({ data: { channelId } }));
      setMembersError(null);
    } catch (caught) {
      setMembers([]);
      setMembersError(
        caught instanceof Error ? caught.message : "Chargement des membres impossible.",
      );
    } finally {
      setMembersLoading(false);
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

  /** Fusionne les signaux de frappe reçus dans la table vivante. */
  const mergeTyping = useCallback((rows: readonly TypingUser[]) => {
    if (rows.length === 0) return;
    for (const row of rows) typingRef.current.set(row.userId, row);
    setTypingUsers([...typingRef.current.values()]);
  }, []);

  /** Purge les signaux expirés puis publie l'état visible. */
  const pruneTyping = useCallback(() => {
    const fresh = pruneTypingUsers([...typingRef.current.values()], Date.now());
    typingRef.current = new Map(fresh.map((user) => [user.userId, user]));
    setTypingUsers(fresh);
  }, []);

  useEffect(() => {
    if (!activeId) {
      typingRef.current.clear();
      setTypingUsers([]);
      setPins([]);
      setPinsError(null);
      setMembers([]);
      return;
    }
    void loadPins(activeId, false);
    void loadMembers(activeId);
  }, [activeId, loadPins, loadMembers]);

  useEffect(() => {
    // Le balayage ne tourne que lorsqu'il y a quelque chose à expirer.
    if (typingUsers.length === 0) return;
    const timer = window.setInterval(pruneTyping, 1000);
    return () => window.clearInterval(timer);
  }, [typingUsers.length, pruneTyping]);

  useEffect(() => {
    if (!activeId) {
      previousChannelRef.current = null;
      warmRef.current = false;
      announcedIdRef.current = null;
      setMessages([]);
      setUnreadCutoff(null);
      setActiveMatchIndex(-1);
      return;
    }
    // Nouvelle conversation : les annonces repartent de zéro (le premier
    // chargement ne doit rien énoncer, l'utilisateur vient d'arriver).
    warmRef.current = false;
    typingRef.current.clear();
    setTypingUsers([]);
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
    let typingPoll: ReturnType<typeof setInterval> | null = null;

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

      // Repli : sans SSE (navigateur ou flux en échec), interrogation courte —
      // l'indicateur de frappe est alors interrogé au même rythme.
      if (!useSse || typeof EventSource === "undefined") {
        interval = setInterval(() => void refreshMessages(activeId), 2500);
        typingPoll = setInterval(() => {
          void listTypingUsersFn({ data: { channelId: activeId } })
            .then(mergeTyping)
            .catch(() => undefined);
        }, TYPING_POLL_MS);
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
      nextSource.addEventListener("typing", (event) => {
        mergeTyping(parseTypingRows((event as MessageEvent<string>).data));
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
      if (typingPoll !== null) clearInterval(typingPoll);
    };
  }, [activeId, refreshChannels, refreshMessages, useSse, mergeTyping]);

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

  // --- Recherche dans le canal courant ---------------------------------------

  const searching = hasActiveFilters(filters);

  /** Messages affichés : le filtre de recherche réduit le fil quand il est actif. */
  const visibleMessages = useMemo(
    () => (searching ? searchMessages(messages, filters) : messages),
    [messages, filters, searching],
  );

  /** Correspondances par message et nombre total (compteur + navigation). */
  const { searchRanges, totalMatches } = useMemo(() => {
    if (!searching || filters.query.trim().length === 0) {
      return { searchRanges: undefined, totalMatches: 0 };
    }
    const ranges = new Map<string, MatchRange[]>();
    let total = 0;
    for (const message of visibleMessages) {
      const found = matchRanges(message.body, filters.query);
      if (found.length === 0) continue;
      ranges.set(message.id, found);
      total += found.length;
    }
    return { searchRanges: ranges, totalMatches: total };
  }, [searching, visibleMessages, filters.query]);

  // Nouvelle recherche : le curseur de résultats repart du premier.
  useEffect(() => {
    setActiveMatchIndex(totalMatches > 0 ? 0 : -1);
  }, [totalMatches]);

  // Annonce du décompte de résultats (le focus reste dans le champ).
  useEffect(() => {
    if (!searching) return;
    const author = filters.authorId
      ? (members.find((member) => member.id === filters.authorId)?.name ?? null)
      : null;
    setAnnouncement(formatResultAnnouncement(totalMatches, filters.query.trim(), author));
  }, [searching, totalMatches, filters, members]);

  // Ouverture/fermeture de la recherche : le focus revient au bouton, mais
  // jamais au premier rendu (il n'a jamais quitté le bouton).
  const searchWasOpenRef = useRef(false);
  useEffect(() => {
    if (searchOpen) {
      searchWasOpenRef.current = true;
      return;
    }
    if (!searchWasOpenRef.current) return;
    searchWasOpenRef.current = false;
    setFilters(EMPTY_FILTERS);
    setActiveMatchIndex(-1);
    searchButtonRef.current?.focus();
  }, [searchOpen]);

  /** Raccourci : « / » ouvre la recherche depuis n'importe où sauf un champ. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      setSearchOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function stepMatch(delta: number) {
    if (totalMatches === 0) return;
    setActiveMatchIndex((current) => stepIndex(current, totalMatches, delta));
  }

  // La correspondance active est amenée au centre de l'écran et reçoit le focus.
  useEffect(() => {
    if (activeMatchIndex < 0) return;
    const node = document.getElementById("chat-match-active");
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
    node?.focus({ preventScroll: true });
  }, [activeMatchIndex]);

  // --- Actions ---------------------------------------------------------------

  async function onSend(body: string, attachments: AttachmentToken[]) {
    if (!activeId) return;
    setBusy(true);
    try {
      const sent = await sendMessageFn({
        data: {
          channelId: activeId,
          body,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
      });
      setMessages((current) => [...current, sent]);
    } catch (caught) {
      push("danger", caught instanceof Error ? caught.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
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
    setDirectoryLoading(true);
    setDirectoryError(null);
    try {
      setOrgMembers(await listOrgMembersFn());
    } catch (caught) {
      setDirectoryError(
        caught instanceof Error ? caught.message : "Chargement des membres impossible.",
      );
    } finally {
      setDirectoryLoading(false);
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

  const typingNames = typingUsers.map((user) => user.name);

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
              searchOpen={searchOpen}
              onToggleSearch={() => setSearchOpen((open) => !open)}
              searchButtonRef={searchButtonRef}
              busy={busy}
            />

            {searchOpen ? (
              <SearchBar
                channelName={active.name}
                authors={mentionCandidates}
                filters={filters}
                onFiltersChange={setFilters}
                counter={searching ? resultCounter(activeMatchIndex, totalMatches) : null}
                onPrevious={() => stepMatch(-1)}
                onNext={() => stepMatch(1)}
                onClose={() => setSearchOpen(false)}
              />
            ) : null}

            {visibleMessages.length === 0 && searching ? (
              <div className="grid flex-1 place-items-center p-6">
                <EmptyState
                  title="Aucun message ne correspond"
                  hint="Changez de mot-clé, d'auteur, ou fermez la recherche pour revoir tout le canal."
                />
              </div>
            ) : (
              <MessageList
                messages={visibleMessages}
                pinnedIds={pinnedIds}
                pinPendingId={pinPendingId}
                onTogglePin={(message) => void onTogglePin(message)}
                unreadCutoff={unreadCutoff}
                announcement={announcement}
                searchRanges={searchRanges}
                activeMatchIndex={activeMatchIndex}
                scrollRef={scrollRef}
              />
            )}

            <TypingIndicator names={typingNames} />

            {active.archived ? (
              <p className="border-t border-border p-4 text-sm text-muted-foreground">
                Ce canal est archivé : l'envoi de messages est désactivé. Son historique reste
                consultable.
              </p>
            ) : (
              <Composer
                channelId={activeId}
                channelName={active.name}
                members={mentionCandidates}
                onSend={(body, attachments) => void onSend(body, attachments)}
                busy={busy}
                onMention={(name) => setAnnouncement(`Mention insérée : @${name}`)}
                onNotice={(message) => push("danger", message)}
              />
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
        {directoryLoading ? (
          <p className="text-sm text-muted-foreground">Chargement des membres…</p>
        ) : directoryError ? (
          <div className="flex flex-col gap-3">
            <p role="alert" className="text-sm text-destructive">
              {directoryError}
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
        members={members}
        loading={membersLoading}
        error={membersError}
        onRetry={() => {
          if (activeId) void loadMembers(activeId);
        }}
        onInvited={() => {
          if (activeId) void loadMembers(activeId);
          void refreshChannels();
        }}
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
