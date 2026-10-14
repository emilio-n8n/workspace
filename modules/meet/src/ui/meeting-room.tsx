import { Alert, Badge, Button, ConfirmDialog, cn, Label } from "@workspace/ui";
import type { Participant } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_POLL_MS, messageAnnouncement } from "../chat.ts";
import { LOBBY_POLL_MS } from "../lobby.ts";
import { describeMediaError } from "../media-errors.ts";
import { type MediaPreferences, toggledMedia } from "../media-preferences.ts";
import { cameraLabel, microphoneLabel } from "../participant-states.ts";
import {
  handAnnouncement,
  muteAnnouncement,
  participantsCountLabel,
  REMOVED_MESSAGE,
  ROSTER_POLL_MS,
  raisedHandsCountLabel,
  raiseHandLabel,
  removalAnnouncement,
  roleAnnouncement,
} from "../participants.ts";
import {
  type ChatHistoryView,
  type ChatMessageView,
  chatMarkReadFn,
  chatMessagesFn,
  chatSendFn,
  type LobbyEntryView,
  leaveRoomFn,
  lobbyAdmitFn,
  lobbyDenyFn,
  lobbyListFn,
  lowerHandFn,
  type RoomToken,
  type RoomView,
  type RosterView,
  removeParticipantFn,
  rosterFn,
  setHandRaisedFn,
  setParticipantMutedFn,
  setParticipantRoleFn,
  setRoomAdmissionFn,
} from "../server.ts";
import { ChatPanel } from "./chat-panel.tsx";
import { LobbyPanel } from "./lobby-panel.tsx";
import { MeetingTile, type MeetingTileData } from "./meeting-tile.tsx";
import { ParticipantsPanel } from "./participants-panel.tsx";

type LiveKitModule = typeof import("livekit-client");
type LiveKitRoomInstance = InstanceType<LiveKitModule["Room"]>;

/** Photographie des participants et de leurs états. */
function readTiles(
  client: LiveKitRoomInstance,
  lk: LiveKitModule,
  local: { micOn: boolean; camOn: boolean },
): MeetingTileData[] {
  const me = client.localParticipant;
  const participants: Participant[] = [me, ...client.remoteParticipants.values()];
  return participants.map((participant) => {
    const isLocal = participant === me;
    return {
      id: participant.identity,
      name: participant.name || participant.identity,
      local: isLocal,
      video: participant.getTrackPublication(lk.Track.Source.Camera)?.track?.mediaStreamTrack,
      audio: participant.getTrackPublication(lk.Track.Source.Microphone)?.track?.mediaStreamTrack,
      microphoneEnabled: isLocal ? local.micOn : participant.isMicrophoneEnabled,
      cameraEnabled: isLocal ? local.camOn : participant.isCameraEnabled,
      speaking: participant.isSpeaking,
    };
  });
}

export type MeetingRoomProps = {
  room: RoomView;
  token: Extract<RoomToken, { configured: true }>;
  /** Réglages d'entrée choisis à l'écran préparatoire. */
  preferences: MediaPreferences;
  /** Persiste un changement de micro/caméra pendant la réunion. */
  onPreferencesChange: (preferences: MediaPreferences) => void;
  onLeave: () => void;
};

/**
 * Réunion en cours — galerie des participants, états micro/caméra visibles et
 * persistants, panneau des participants (rôles, mains levées, modération),
 * chat de réunion et file d'admission pour l'organisateur.
 */
export function MeetingRoom({
  room,
  token,
  preferences,
  onPreferencesChange,
  onLeave,
}: MeetingRoomProps) {
  const lkRef = useRef<LiveKitModule | null>(null);
  const clientRef = useRef<LiveKitRoomInstance | null>(null);
  // État micro/caméra : la state sert au rendu, le miroir (ref) aux rappels
  // LiveKit et à la lecture des vignettes.
  const [media, setMedia] = useState({
    micOn: preferences.microphoneOn,
    camOn: preferences.cameraOn,
  });
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  const [tiles, setTiles] = useState<MeetingTileData[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "failed">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [entries, setEntries] = useState<LobbyEntryView[]>([]);
  const [lobbyBusy, setLobbyBusy] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [admissionRequired, setAdmissionRequired] = useState(room.requireAdmission);

  // Roster (participants, rôles, mains), modération et chat.
  const [roster, setRoster] = useState<RosterView | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [moderationBusy, setModerationBusy] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<ChatHistoryView>({ messages: [], unread: 0 });
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<RosterView["participants"][number] | null>(
    null,
  );
  const [removed, setRemoved] = useState(false);

  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const lastMessageIdRef = useRef<string | null>(null);
  const chatInitializedRef = useRef(false);

  // Configuration figée à l'entrée : une bascule micro/caméra ne reconnecte
  // jamais la réunion.
  const joinConfig = useRef({
    token,
    microphoneDeviceId: preferences.microphoneDeviceId,
    cameraDeviceId: preferences.cameraDeviceId,
    speakerDeviceId: preferences.speakerDeviceId,
  }).current;

  const syncTiles = useCallback(() => {
    const client = clientRef.current;
    const lk = lkRef.current;
    if (!client || !lk) return;
    setTiles(readTiles(client, lk, mediaRef.current));
  }, []);

  useEffect(() => {
    let disposed = false;
    let client: LiveKitRoomInstance | null = null;

    void (async () => {
      try {
        const lk = await import("livekit-client");
        lkRef.current = lk;
        client = new lk.Room({
          adaptiveStream: true,
          audioCaptureDefaults: joinConfig.microphoneDeviceId
            ? { deviceId: joinConfig.microphoneDeviceId }
            : undefined,
          videoCaptureDefaults: joinConfig.cameraDeviceId
            ? { deviceId: joinConfig.cameraDeviceId }
            : undefined,
          audioOutput: joinConfig.speakerDeviceId
            ? { deviceId: joinConfig.speakerDeviceId }
            : undefined,
        });

        const refresh = () => {
          if (!disposed) syncTiles();
        };
        client.on(lk.RoomEvent.ParticipantConnected, refresh);
        client.on(lk.RoomEvent.ParticipantDisconnected, refresh);
        client.on(lk.RoomEvent.TrackSubscribed, refresh);
        client.on(lk.RoomEvent.TrackUnsubscribed, refresh);
        client.on(lk.RoomEvent.TrackMuted, refresh);
        client.on(lk.RoomEvent.TrackUnmuted, refresh);
        client.on(lk.RoomEvent.LocalTrackPublished, refresh);
        client.on(lk.RoomEvent.LocalTrackUnpublished, refresh);
        client.on(lk.RoomEvent.Disconnected, refresh);

        await client.connect(joinConfig.token.url, joinConfig.token.token);
        if (disposed) {
          await client.disconnect().catch(() => {});
          return;
        }
        clientRef.current = client;
        await client.localParticipant.setMicrophoneEnabled(mediaRef.current.micOn);
        await client.localParticipant.setCameraEnabled(mediaRef.current.camOn);
        syncTiles();
        setStatus("connected");
      } catch (caught) {
        if (disposed) return;
        setError(caught instanceof Error ? caught.message : "Connexion à la salle impossible.");
        setStatus("failed");
      }
    })();

    return () => {
      disposed = true;
      clientRef.current = null;
      if (client) void client.disconnect().catch(() => {});
    };
  }, [joinConfig, syncTiles]);

  /* ---------------------------- salle d'attente ---------------------------- */

  useEffect(() => {
    if (!room.mine) return;
    let active = true;
    const load = async () => {
      try {
        const rows = await lobbyListFn({ data: { slug: room.slug } });
        if (active) setEntries(rows);
      } catch (caught) {
        if (active) {
          setLobbyError(caught instanceof Error ? caught.message : "Salle d'attente indisponible.");
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), LOBBY_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [room.mine, room.slug]);

  const resolveEntry = useCallback(
    async (userId: string, decision: "admit" | "deny") => {
      setLobbyBusy(true);
      setLobbyError(null);
      try {
        const resolved =
          decision === "admit"
            ? await lobbyAdmitFn({ data: { slug: room.slug, userId } })
            : await lobbyDenyFn({ data: { slug: room.slug, userId } });
        setEntries((current) => current.filter((entry) => entry.userId !== resolved.userId));
        setAnnouncement(
          decision === "admit"
            ? `${resolved.userName} a été admis dans la salle.`
            : `L'entrée de ${resolved.userName} a été refusée.`,
        );
      } catch (caught) {
        setLobbyError(caught instanceof Error ? caught.message : "Action impossible.");
      } finally {
        setLobbyBusy(false);
      }
    },
    [room.slug],
  );

  /* ------------------------ participants et modération ------------------------ */

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await rosterFn({ data: { slug: room.slug } });
        if (!active) return;
        setRoster(next);
        setRosterError(null);
      } catch (caught) {
        if (active) {
          setRosterError(
            caught instanceof Error ? caught.message : "Liste des participants indisponible.",
          );
        }
      } finally {
        if (active) setRosterLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), ROSTER_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [room.slug]);

  const runRosterAction = useCallback(
    async (action: () => Promise<unknown>, message: string) => {
      setModerationBusy(true);
      setRosterError(null);
      try {
        await action();
        const next = await rosterFn({ data: { slug: room.slug } });
        setRoster(next);
        setAnnouncement(message);
      } catch (caught) {
        setRosterError(caught instanceof Error ? caught.message : "Action impossible.");
      } finally {
        setModerationBusy(false);
      }
    },
    [room.slug],
  );

  const toggleHand = useCallback(() => {
    const current = roster?.self?.handRaised ?? false;
    const name = roster?.self?.name ?? "Un participant";
    void runRosterAction(
      () => setHandRaisedFn({ data: { slug: room.slug, raised: !current } }),
      handAnnouncement(name, !current),
    );
  }, [roster?.self, room.slug, runRosterAction]);

  const lowerHand = useCallback(
    (userId: string, name: string) =>
      void runRosterAction(
        () => lowerHandFn({ data: { slug: room.slug, userId } }),
        handAnnouncement(name, false),
      ),
    [room.slug, runRosterAction],
  );

  const setMuted = useCallback(
    (userId: string, name: string, muted: boolean) =>
      void runRosterAction(
        () => setParticipantMutedFn({ data: { slug: room.slug, userId, muted } }),
        muteAnnouncement(name, muted),
      ),
    [room.slug, runRosterAction],
  );

  const setRole = useCallback(
    (userId: string, name: string, role: "moderator" | "participant") =>
      void runRosterAction(
        () => setParticipantRoleFn({ data: { slug: room.slug, userId, role } }),
        roleAnnouncement(name, role),
      ),
    [room.slug, runRosterAction],
  );

  const confirmRemoval = useCallback(() => {
    const target = pendingRemoval;
    setPendingRemoval(null);
    if (!target) return;
    void runRosterAction(
      () => removeParticipantFn({ data: { slug: room.slug, userId: target.userId } }),
      removalAnnouncement(target.name),
    );
  }, [pendingRemoval, room.slug, runRosterAction]);

  // Retrait de la réunion : la personne est écartée dès que le service le signale.
  useEffect(() => {
    if (roster?.self?.removed) setRemoved(true);
  }, [roster?.self?.removed]);

  useEffect(() => {
    if (!removed) return;
    void clientRef.current?.disconnect().catch(() => {});
  }, [removed]);

  // Micro coupé par l'organisateur : la personne ne peut pas le rétablir.
  const mutedByHost = roster?.self?.mutedByHost ?? false;
  const selfName = roster?.self?.name ?? "Votre micro";
  useEffect(() => {
    if (!mutedByHost || !mediaRef.current.micOn) return;
    const updated = { ...mediaRef.current, micOn: false };
    mediaRef.current = updated;
    setMedia(updated);
    onPreferencesChange(toggledMedia(preferencesRef.current, "microphone"));
    void clientRef.current?.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    syncTiles();
    setAnnouncement(muteAnnouncement(selfName, true));
  }, [mutedByHost, selfName, onPreferencesChange, syncTiles]);

  /* --------------------------------- chat --------------------------------- */

  const markRead = useCallback(async () => {
    try {
      await chatMarkReadFn({ data: { slug: room.slug } });
      setChat((current) => (current.unread === 0 ? current : { ...current, unread: 0 }));
    } catch {
      // Repère de lecture : nouvel essai au prochain rafraîchissement.
    }
  }, [room.slug]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await chatMessagesFn({ data: { slug: room.slug } });
        if (!active) return;
        setChat(next);
        setChatError(null);
        const newest = next.messages.at(-1) ?? null;
        if (!chatInitializedRef.current) {
          chatInitializedRef.current = true;
          lastMessageIdRef.current = newest?.id ?? null;
        } else if (newest && newest.id !== lastMessageIdRef.current) {
          lastMessageIdRef.current = newest.id;
          if (!newest.own && !chatOpenRef.current) {
            setAnnouncement(messageAnnouncement(newest.userName, newest.body));
          }
        }
        if (chatOpenRef.current) void markRead();
      } catch (caught) {
        if (active) {
          setChatError(caught instanceof Error ? caught.message : "Chat indisponible.");
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), CHAT_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [room.slug, markRead]);

  const openChat = useCallback(() => {
    setChatOpen(true);
    void markRead();
  }, [markRead]);

  const sendMessage = useCallback(
    async (body: string): Promise<boolean> => {
      setChatBusy(true);
      setChatError(null);
      try {
        const sent: ChatMessageView = await chatSendFn({ data: { slug: room.slug, body } });
        lastMessageIdRef.current = sent.id;
        setChat((current) => ({ messages: [...current.messages, sent], unread: current.unread }));
        return true;
      } catch (caught) {
        setChatError(caught instanceof Error ? caught.message : "Envoi du message impossible.");
        return false;
      } finally {
        setChatBusy(false);
      }
    },
    [room.slug],
  );

  /* --------------------------- états micro/caméra --------------------------- */

  const toggleMedia = useCallback(
    async (kind: "microphone" | "camera") => {
      const current = mediaRef.current;
      const next = kind === "microphone" ? !current.micOn : !current.camOn;
      const updated =
        kind === "microphone" ? { ...current, micOn: next } : { ...current, camOn: next };
      mediaRef.current = updated;
      setMedia(updated);
      onPreferencesChange(toggledMedia(preferencesRef.current, kind));
      setAnnouncement(kind === "microphone" ? microphoneLabel(next) : cameraLabel(next));

      const client = clientRef.current;
      const deviceId =
        kind === "microphone" ? joinConfig.microphoneDeviceId : joinConfig.cameraDeviceId;
      if (client) {
        try {
          if (kind === "microphone") {
            await client.localParticipant.setMicrophoneEnabled(
              next,
              deviceId ? { deviceId } : undefined,
            );
          } else {
            await client.localParticipant.setCameraEnabled(
              next,
              deviceId ? { deviceId } : undefined,
            );
          }
        } catch (caught) {
          setError(
            describeMediaError(kind === "microphone" ? "microphone" : "camera", caught).action,
          );
        }
      }
      syncTiles();
    },
    [onPreferencesChange, syncTiles, joinConfig.microphoneDeviceId, joinConfig.cameraDeviceId],
  );

  const toggleAdmission = useCallback(
    async (required: boolean) => {
      try {
        await setRoomAdmissionFn({ data: { slug: room.slug, required } });
        setAdmissionRequired(required);
        setAnnouncement(
          required
            ? "Salle d'attente activée : les nouvelles personnes doivent être admises."
            : "Salle d'attente désactivée : l'entrée est libre.",
        );
      } catch (caught) {
        setLobbyError(
          caught instanceof Error
            ? caught.message
            : "Modification de la salle d'attente impossible.",
        );
      }
    },
    [room.slug],
  );

  const handleLeave = useCallback(async () => {
    try {
      await leaveRoomFn({ data: { slug: room.slug } });
    } catch {
      // Quitter reste possible même si le service est momentanément indisponible.
    }
    onLeave();
  }, [room.slug, onLeave]);

  const micOn = media.micOn;
  const camOn = media.camOn;
  const handRaised = roster?.self?.handRaised ?? false;
  const hands = roster?.hands ?? [];
  const count = roster?.count ?? tiles.length;
  const handByUser = new Map((roster?.participants ?? []).map((p) => [p.userId, p.handRaised]));

  if (status === "failed") {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3">
        <Alert tone="danger" title="Connexion impossible">
          <p>
            {error ??
              "La connexion au serveur média a échoué. Vérifiez votre connexion réseau, puis réessayez."}
          </p>
        </Alert>
        <Button className="self-start" variant="outline" onClick={onLeave}>
          ← Retour aux salles
        </Button>
      </div>
    );
  }

  if (removed) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3">
        <Alert tone="danger" title="Vous avez été retiré de la réunion">
          <p>{REMOVED_MESSAGE}</p>
        </Alert>
        <Button className="self-start" variant="outline" onClick={() => void handleLeave()}>
          ← Retour aux salles
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-lg font-semibold">{room.name}</h1>
        <span className="text-xs text-muted-foreground">{participantsCountLabel(count)}</span>
        {hands.length > 0 ? (
          <Badge variant="outline">{raisedHandsCountLabel(hands.length)}</Badge>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPeopleOpen(true)}>
            Participants
            {hands.length > 0 ? <span className="tabular-nums"> ({hands.length})</span> : null}
          </Button>
          <Button
            size="sm"
            variant={handRaised ? "secondary" : "outline"}
            aria-pressed={handRaised}
            onClick={toggleHand}
          >
            {raiseHandLabel(handRaised)}
          </Button>
          <Button size="sm" variant="outline" onClick={openChat}>
            Chat
            {chat.unread > 0 ? <span className="tabular-nums"> ({chat.unread})</span> : null}
            {chat.unread > 0 ? <span className="sr-only">, messages non lus</span> : null}
          </Button>
          <Button
            size="sm"
            variant={micOn ? "outline" : "secondary"}
            aria-pressed={!micOn}
            disabled={mutedByHost}
            onClick={() => void toggleMedia("microphone")}
          >
            {micOn ? "Couper le micro" : "Activer le micro"}
            <span className="sr-only">
              {" "}
              — micro {micOn ? "activé" : "coupé"}
              {mutedByHost ? ", coupé par l'organisateur" : ""}
            </span>
          </Button>
          <Button
            size="sm"
            variant={camOn ? "outline" : "secondary"}
            aria-pressed={!camOn}
            onClick={() => void toggleMedia("camera")}
          >
            {camOn ? "Couper la caméra" : "Activer la caméra"}
            <span className="sr-only"> — caméra {camOn ? "activée" : "coupée"}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => void handleLeave()}
          >
            Quitter
          </Button>
        </div>
      </header>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {error ? (
        <Alert tone="danger">
          <p>{error}</p>
        </Alert>
      ) : null}

      {mutedByHost ? (
        <Alert tone="warning" title="Micro coupé par l'organisateur">
          <p>L'organisateur a coupé votre micro. Vous ne pouvez pas le rétablir vous-même.</p>
        </Alert>
      ) : null}

      {status === "connecting" ? (
        <p className="text-sm text-muted-foreground">Connexion à la salle…</p>
      ) : null}

      <div
        className={cn(
          "grid gap-3",
          tiles.length <= 1 ? "grid-cols-1" : "sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {tiles.map((tile) => (
          <MeetingTile key={tile.id} tile={tile} handRaised={handByUser.get(tile.id) ?? false} />
        ))}
      </div>

      {room.mine ? (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <input
              id="meet-admission"
              type="checkbox"
              className="size-4 rounded border-input"
              checked={!admissionRequired}
              onChange={(event) => void toggleAdmission(!event.target.checked)}
            />
            <Label htmlFor="meet-admission">Autoriser l'entrée sans admission</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {admissionRequired
              ? "Les personnes doivent être admises depuis la file ci-dessous."
              : "Toute personne de l'organisation qui ouvre le lien entre directement."}
          </p>
          <LobbyPanel
            entries={entries}
            busy={lobbyBusy}
            error={lobbyError}
            onAdmit={(userId) => void resolveEntry(userId, "admit")}
            onDeny={(userId) => void resolveEntry(userId, "deny")}
          />
        </section>
      ) : null}

      <ParticipantsPanel
        open={peopleOpen}
        onClose={() => setPeopleOpen(false)}
        roster={roster}
        loading={rosterLoading}
        error={rosterError}
        busy={moderationBusy}
        onMute={(participant, muted) => setMuted(participant.userId, participant.name, muted)}
        onRemove={(participant) => setPendingRemoval(participant)}
        onLowerHand={(participant) => lowerHand(participant.userId, participant.name)}
        onSetRole={(participant, role) => setRole(participant.userId, participant.name, role)}
      />

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={chat.messages}
        unread={chat.unread}
        error={chatError}
        busy={chatBusy}
        onSend={sendMessage}
      />

      <ConfirmDialog
        open={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        onConfirm={confirmRemoval}
        title={`Retirer « ${pendingRemoval?.name ?? ""} » de la réunion ?`}
        message="Cette personne sera écartée de la salle et ne pourra plus la rejoindre. Elle pourra de nouveau être admise par l'organisateur."
        confirmLabel="Retirer"
        destructive
        busy={moderationBusy}
      />
    </div>
  );
}
