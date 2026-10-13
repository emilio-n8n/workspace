import { Alert, Button, cn, Label } from "@workspace/ui";
import type { Participant } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LOBBY_POLL_MS } from "../lobby.ts";
import { describeMediaError } from "../media-errors.ts";
import { type MediaPreferences, toggledMedia } from "../media-preferences.ts";
import { cameraLabel, microphoneLabel } from "../participant-states.ts";
import {
  type LobbyEntryView,
  lobbyAdmitFn,
  lobbyDenyFn,
  lobbyListFn,
  type RoomToken,
  type RoomView,
  setRoomAdmissionFn,
} from "../server.ts";
import { LobbyPanel } from "./lobby-panel.tsx";
import { MeetingTile, type MeetingTileData } from "./meeting-tile.tsx";

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
 * persistants, et file d'admission pour l'organisateur.
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

  const micOn = media.micOn;
  const camOn = media.camOn;

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

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-lg font-semibold">{room.name}</h1>
        <span className="text-xs text-muted-foreground">
          {tiles.length} participant{tiles.length > 1 ? "s" : ""}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={micOn ? "outline" : "secondary"}
            aria-pressed={!micOn}
            onClick={() => void toggleMedia("microphone")}
          >
            {micOn ? "Couper le micro" : "Activer le micro"}
            <span className="sr-only"> — micro {micOn ? "activé" : "coupé"}</span>
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
          <Button size="sm" variant="outline" className="text-destructive" onClick={onLeave}>
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
          <MeetingTile key={tile.id} tile={tile} />
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
    </div>
  );
}
