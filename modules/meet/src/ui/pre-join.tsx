import { Alert, Badge, Button, cn, IconVideo, Label } from "@workspace/ui";
import { useEffect, useRef } from "react";
import {
  type LobbyStateView,
  lobbyActionIsJoin,
  lobbyActionIsPending,
  lobbyActionLabel,
  lobbyMessage,
  lobbyTitle,
  lobbyTone,
} from "../lobby.ts";
import { MIC_LEVEL_STEPS, micLevelLabel } from "../media-level.ts";
import {
  type MediaDevice,
  type MediaDeviceKind,
  mediaKindLabel,
  resolveDeviceId,
} from "../media-preferences.ts";
import { cameraLabel, microphoneLabel } from "../participant-states.ts";
import { useMediaPreview } from "./use-media-preview.ts";

/** Identifiants stables des barres du vu-mètre (clés de liste). */
const MIC_BARS = Array.from({ length: MIC_LEVEL_STEPS }, (_, index) => `barre-${index + 1}`);

/** Aperçu vidéo local : miroir, muet, jamais renvoyé dans la salle. */
function PreviewSurface({ stream, cameraOn }: { stream: MediaStream | null; cameraOn: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = cameraOn ? stream : null;
  }, [stream, cameraOn]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-muted">
      {cameraOn && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="size-full -scale-x-100 object-cover"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 text-center">
          <IconVideo />
          <p className="text-sm text-muted-foreground">
            {cameraOn ? "Démarrage de la caméra…" : "Votre caméra est coupée"}
          </p>
        </div>
      )}
    </div>
  );
}

/** Vu-mètre du micro : mesure locale purement visuelle. */
function MicMeterView({
  bars,
  speaking,
  muted,
}: {
  bars: number;
  speaking: boolean;
  muted: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2", muted && "opacity-60")}>
      {/* biome-ignore lint/a11y/useSemanticElements: barres sur mesure, l'élément <meter> natif n'accepte pas ce rendu segmenté. */}
      <div
        role="meter"
        aria-label="Niveau du micro"
        aria-valuemin={0}
        aria-valuemax={MIC_LEVEL_STEPS}
        aria-valuenow={bars}
        aria-valuetext={micLevelLabel(bars)}
        className="flex h-2 flex-1 items-stretch gap-0.5 overflow-hidden rounded-full border border-border bg-card"
      >
        {MIC_BARS.map((bar, position) => (
          <span
            key={bar}
            aria-hidden
            className={cn("flex-1 rounded-full", position < bars && "bg-primary")}
          />
        ))}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {muted ? "Micro coupé" : speaking ? "Vous parlez" : "Silence"}
      </span>
    </div>
  );
}

function DeviceSelect({
  kind,
  devices,
  value,
  onSelect,
}: {
  kind: MediaDeviceKind;
  devices: readonly MediaDevice[];
  value: string | null;
  onSelect: (kind: MediaDeviceKind, deviceId: string) => void;
}) {
  const id = `meet-device-${kind}`;
  const sameKind = devices.filter((device) => device.kind === kind);
  const selected = resolveDeviceId(kind, devices, value) ?? "";

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{mediaKindLabel(kind)}</Label>
      <select
        id={id}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        value={selected}
        onChange={(event) => onSelect(kind, event.target.value)}
        disabled={sameKind.length === 0}
      >
        {sameKind.length === 0 ? (
          <option value="">Aucun périphérique détecté</option>
        ) : (
          sameKind.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))
        )}
      </select>
    </div>
  );
}

export type PreJoinScreenProps = {
  roomName: string;
  slug: string;
  /** Capacité d'entrée : organisateur, salle libre, attente ou refus. */
  lobby: { required: boolean; host: boolean; state: LobbyStateView };
  /** Renseigné si aucun serveur média n'est configuré (ADR-0011). */
  mediaUnconfiguredNote?: string;
  /** Information courte à afficher (demande envoyée, salle quittée…). */
  notice?: string | null;
  busy: boolean;
  onJoin: () => void;
  onRequest: () => void;
  onWithdraw: () => void;
};

/**
 * Écran préparatoire — aperçu caméra, vu-mètre du micro et sélection des
 * périphériques avant d'entrer. Les refus du navigateur y sont traduits en
 * français actionnable, et l'état choisi est conservé pour la prochaine fois.
 */
export function PreJoinScreen({
  roomName,
  slug,
  lobby,
  mediaUnconfiguredNote,
  notice,
  busy,
  onJoin,
  onRequest,
  onWithdraw,
}: PreJoinScreenProps) {
  const preview = useMediaPreview();
  const { preferences } = preview;
  const state = lobby.state;
  const direct = !lobby.required || lobby.host;
  const actionLabel = direct ? "Rejoindre la salle" : lobbyActionLabel(state);
  const actionIsJoin = direct || lobbyActionIsJoin(state);
  const pending = lobbyActionIsPending(state);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Retour aux salles
      </a>

      <div className="grid gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-3">
          <header className="flex flex-col gap-1">
            <h1 className="font-display text-xl font-semibold tracking-tight">{roomName}</h1>
            <p className="text-sm text-muted-foreground">Salle /room/{slug}</p>
          </header>

          <PreviewSurface stream={preview.stream} cameraOn={preferences.cameraOn} />

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={preferences.microphoneOn ? "outline" : "destructive"}>
              {microphoneLabel(preferences.microphoneOn)}
            </Badge>
            <Badge variant={preferences.cameraOn ? "outline" : "destructive"}>
              {cameraLabel(preferences.cameraOn)}
            </Badge>
          </div>

          <MicMeterView
            bars={preview.meter.bars}
            speaking={preview.meter.speaking}
            muted={!preferences.microphoneOn}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={preferences.microphoneOn ? "outline" : "secondary"}
              aria-pressed={!preferences.microphoneOn}
              onClick={() => preview.toggle("microphone")}
            >
              {preferences.microphoneOn ? "Couper le micro" : "Activer le micro"}
              <span className="sr-only">
                {" "}
                — micro {preferences.microphoneOn ? "activé" : "coupé"}
              </span>
            </Button>
            <Button
              size="sm"
              variant={preferences.cameraOn ? "outline" : "secondary"}
              aria-pressed={!preferences.cameraOn}
              onClick={() => preview.toggle("camera")}
            >
              {preferences.cameraOn ? "Couper la caméra" : "Activer la caméra"}
              <span className="sr-only">
                {" "}
                — caméra {preferences.cameraOn ? "activée" : "coupée"}
              </span>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="font-display text-sm font-semibold">Périphériques</h2>
          <DeviceSelect
            kind="camera"
            devices={preview.devices}
            value={preferences.cameraDeviceId}
            onSelect={preview.selectDevice}
          />
          <DeviceSelect
            kind="microphone"
            devices={preview.devices}
            value={preferences.microphoneDeviceId}
            onSelect={preview.selectDevice}
          />
          <DeviceSelect
            kind="speaker"
            devices={preview.devices}
            value={preferences.speakerDeviceId}
            onSelect={preview.selectDevice}
          />
          <p className="text-xs text-muted-foreground">
            Ces réglages sont conservés pour vos prochaines réunions sur ce navigateur.
          </p>

          {preview.error ? (
            <Alert tone="danger" title={preview.error.title}>
              <p>{preview.error.action}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={preview.retry}>
                Réessayer
              </Button>
            </Alert>
          ) : null}

          {mediaUnconfiguredNote ? (
            <Alert tone="info" title="Serveur média non configuré">
              <p>{mediaUnconfiguredNote}</p>
            </Alert>
          ) : null}
        </div>
      </div>

      {state === "waiting" || state === "denied" ? (
        <Alert tone={lobbyTone(state)} title={lobbyTitle(state)}>
          <p>{lobbyMessage(state)}</p>
        </Alert>
      ) : null}

      {notice ? (
        <Alert tone="info">
          <p>{notice}</p>
        </Alert>
      ) : null}

      {mediaUnconfiguredNote ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Button loading={busy || pending} onClick={() => (actionIsJoin ? onJoin() : onRequest())}>
            {actionLabel}
          </Button>
          {pending ? (
            <Button variant="ghost" onClick={onWithdraw}>
              Annuler ma demande
            </Button>
          ) : null}
        </div>
      )}

      <p className="sr-only" role="status">
        {`${microphoneLabel(preferences.microphoneOn)}, ${cameraLabel(preferences.cameraOn)}.`}
      </p>
    </div>
  );
}
