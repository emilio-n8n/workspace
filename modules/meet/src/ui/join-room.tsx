import { Button, cn } from "@workspace/ui";
import type { Room as LiveKitRoom, Participant } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRoomFn, getRoomTokenFn, type RoomToken, type RoomView } from "../server.ts";

type Tile = {
  id: string;
  name: string;
  local: boolean;
  video?: MediaStreamTrack;
  audio?: MediaStreamTrack;
};

function VideoTile({ tile }: { tile: Tile }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = videoRef.current;
    if (element && tile.video) {
      element.srcObject = new MediaStream([tile.video]);
    }
  }, [tile.video]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">
      {tile.video ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={tile.local}
          className="aspect-video w-full object-cover"
        />
      ) : (
        <div className="grid aspect-video w-full place-items-center text-sm text-muted-foreground">
          {tile.name}
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded bg-rail/70 px-2 py-0.5 text-xs text-rail-foreground">
        {tile.name}
        {tile.local ? " (vous)" : ""}
      </span>
      {tile.audio ? <AudioTrack track={tile.audio} muted={tile.local} /> : null}
    </div>
  );
}

function AudioTrack({ track, muted }: { track: MediaStreamTrack; muted: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = audioRef.current;
    if (element) element.srcObject = new MediaStream([track]);
  }, [track]);
  return <audio ref={audioRef} autoPlay muted={muted} />;
}

type Phase = "loading" | "lobby" | "connecting" | "connected" | "ended" | "error";

/**
 * Salle de réunion : salle d'attente puis connexion LiveKit si le serveur
 * média est configuré (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) —
 * sinon la page explique la configuration requise (ADR-0011).
 */
export function JoinRoom({ slug }: { slug: string }) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [token, setToken] = useState<RoomToken | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const lkRef = useRef<LiveKitRoom | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [roomInfo, roomToken] = await Promise.all([
          getRoomFn({ data: { slug } }),
          getRoomTokenFn({ data: { slug } }),
        ]);
        setRoom(roomInfo);
        setToken(roomToken);
        setPhase("lobby");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Salle introuvable.");
        setPhase("error");
      }
    })();
  }, [slug]);

  const join = useCallback(async () => {
    if (!token?.configured) return;
    setPhase("connecting");
    setError(null);
    try {
      const lk = await import("livekit-client");
      const livekitRoom = new lk.Room({ adaptiveStream: true });

      const upsert = (participant: Participant, local: boolean) => {
        const video = participant.getTrackPublication(lk.Track.Source.Camera)?.track
          ?.mediaStreamTrack;
        const audio = participant.getTrackPublication(lk.Track.Source.Microphone)?.track
          ?.mediaStreamTrack;
        setTiles((current) => {
          const next = current.filter((tile) => tile.id !== participant.identity);
          next.push({
            id: participant.identity,
            name: participant.name || participant.identity,
            local,
            video,
            audio,
          });
          return next;
        });
      };

      livekitRoom.on(lk.RoomEvent.ParticipantConnected, (participant) =>
        upsert(participant, false),
      );
      livekitRoom.on(lk.RoomEvent.TrackSubscribed, (_track, _publication, participant) =>
        upsert(participant, false),
      );
      livekitRoom.on(lk.RoomEvent.TrackUnsubscribed, (_track, _publication, participant) =>
        upsert(participant, false),
      );
      livekitRoom.on(lk.RoomEvent.LocalTrackPublished, () =>
        upsert(livekitRoom.localParticipant, true),
      );
      livekitRoom.on(lk.RoomEvent.ParticipantDisconnected, (participant) =>
        setTiles((current) => current.filter((tile) => tile.id !== participant.identity)),
      );
      livekitRoom.on(lk.RoomEvent.Disconnected, () => setPhase("ended"));

      await livekitRoom.connect(token.url, token.token);
      await livekitRoom.localParticipant.enableCameraAndMicrophone();
      upsert(livekitRoom.localParticipant, true);
      lkRef.current = livekitRoom;
      setPhase("connected");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connexion impossible.");
      setPhase("error");
    }
  }, [token]);

  function leave() {
    lkRef.current?.disconnect();
    lkRef.current = null;
    setTiles([]);
    setPhase("ended");
  }

  async function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    await lkRef.current?.localParticipant.setMicrophoneEnabled(next);
  }

  async function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    await lkRef.current?.localParticipant.setCameraEnabled(next);
  }

  if (phase === "loading") {
    return <p className="text-sm text-muted-foreground">Chargement de la salle…</p>;
  }

  if (phase === "error") {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <a href="/" className="text-sm font-medium text-primary hover:underline">
          ← Retour aux salles
        </a>
      </div>
    );
  }

  if (phase === "connected") {
    return (
      <div className="flex flex-col gap-3">
        <header className="flex items-center gap-2">
          <h1 className="font-display text-lg font-semibold">{room?.name}</h1>
          <span className="text-xs text-muted-foreground">{tiles.length} participant(s)</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant={micOn ? "outline" : "primary"}
              onClick={() => void toggleMic()}
            >
              {micOn ? "Couper le micro" : "Activer le micro"}
            </Button>
            <Button
              size="sm"
              variant={camOn ? "outline" : "primary"}
              onClick={() => void toggleCam()}
            >
              {camOn ? "Couper la caméra" : "Activer la caméra"}
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={leave}>
              Quitter
            </Button>
          </div>
        </header>
        <div className={cn("grid gap-3", tiles.length <= 1 ? "grid-cols-1" : "sm:grid-cols-2")}>
          {tiles.map((tile) => (
            <VideoTile key={tile.id} tile={tile} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Retour aux salles
      </a>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-6">
        <h1 className="font-display text-xl font-semibold tracking-tight">{room?.name}</h1>
        <p className="text-sm text-muted-foreground">Salle /room/{slug}</p>

        {token && !token.configured ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Serveur média non configuré</p>
            <p>
              La salle et son lien fonctionnent, mais l'audio/vidéo nécessite un serveur LiveKit.
              Renseignez <code className="rounded bg-background px-1">LIVEKIT_URL</code>,{" "}
              <code className="rounded bg-background px-1">LIVEKIT_API_KEY</code> et{" "}
              <code className="rounded bg-background px-1">LIVEKIT_API_SECRET</code> pour activer la
              visioconférence (voir docs/modules/meet.md et ADR-0011).
            </p>
          </div>
        ) : null}

        {phase === "ended" ? (
          <p className="text-sm text-muted-foreground">Vous avez quitté la salle.</p>
        ) : null}

        {token?.configured ? (
          <Button
            className="self-start"
            loading={phase === "connecting"}
            onClick={() => void join()}
          >
            {phase === "ended" ? "Rejoindre à nouveau" : "Rejoindre la salle"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
