import { cn } from "@workspace/ui";
import { useEffect, useRef } from "react";
import {
  cameraLabel,
  microphoneLabel,
  type ParticipantState,
  participantLabel,
} from "../participant-states.ts";

/** Une vignette de la galerie : un participant, ses pistes, ses états. */
export type MeetingTileData = ParticipantState & {
  id: string;
  video?: MediaStreamTrack;
  audio?: MediaStreamTrack;
};

/** Flux audio d'un participant distant (jamais pour soi-même : écho). */
function AudioTrack({ track }: { track: MediaStreamTrack }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = audioRef.current;
    if (element) element.srcObject = new MediaStream([track]);
  }, [track]);
  return (
    // biome-ignore lint/a11y/useMediaCaption: flux audio temps réel pair-à-pair, sans fichier de sous-titres (transcription LiveKit hors périmètre).
    <audio ref={audioRef} autoPlay />
  );
}

/**
 * Vignette d'un participant — vidéo si la caméra est ouverte, sinon un cartouche
 * avec le nom et les états « micro coupé » / « caméra coupée » bien visibles.
 */
export function MeetingTile({ tile }: { tile: MeetingTileData }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const live = tile.video !== undefined && tile.cameraEnabled;

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = live && tile.video ? new MediaStream([tile.video]) : null;
  }, [live, tile.video]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card",
        tile.speaking && "ring-2 ring-ring",
      )}
    >
      {live ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={tile.local}
          className={cn("aspect-video w-full object-cover", tile.local && "-scale-x-100")}
        />
      ) : (
        <div className="grid aspect-video w-full place-items-center bg-muted px-3 text-center">
          <span className="font-display text-sm font-medium text-foreground">
            {tile.local ? "Vous" : tile.name}
          </span>
        </div>
      )}

      <div className="absolute inset-x-2 bottom-2 flex flex-wrap items-center gap-1">
        <span className="rounded-md bg-rail/80 px-2 py-0.5 text-xs text-rail-foreground">
          {tile.local ? "Vous" : tile.name}
        </span>
        {!tile.microphoneEnabled ? (
          <span className="rounded-md bg-rail/80 px-2 py-0.5 text-xs font-medium text-rail-foreground">
            {microphoneLabel(tile.microphoneEnabled)}
          </span>
        ) : null}
        {!tile.cameraEnabled ? (
          <span className="rounded-md bg-rail/80 px-2 py-0.5 text-xs font-medium text-rail-foreground">
            {cameraLabel(tile.cameraEnabled)}
          </span>
        ) : null}
      </div>

      {/* Résumé identique pour tout le monde, lu en plus du visuel. */}
      <p className="sr-only">{participantLabel(tile)}</p>

      {tile.audio && !tile.local ? <AudioTrack track={tile.audio} /> : null}
    </div>
  );
}
