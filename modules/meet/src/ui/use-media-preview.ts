import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeMediaError,
  guidanceFor,
  type MediaErrorGuidance,
  mediaCaptureFailure,
} from "../media-errors.ts";
import { activeLevelBars, micLevelLabel, normalizeRms, speakingState } from "../media-level.ts";
import {
  captureConstraints,
  loadMediaPreferences,
  type MediaDevice,
  type MediaDeviceKind,
  type MediaPreferences,
  type MediaPreferencesStorage,
  normalizeDevices,
  resolveDeviceId,
  saveMediaPreferences,
  toggledMedia,
  withDevice,
} from "../media-preferences.ts";

/** État de l'aperçu local : éteint, démarrage, actif, refus, indisponible. */
export type MediaPreviewStatus = "off" | "starting" | "live" | "blocked" | "unavailable";

export type MicMeter = {
  bars: number;
  levelLabel: string;
  speaking: boolean;
};

export type MediaPreviewState = MicMeter & {
  status: MediaPreviewStatus;
  devices: MediaDevice[];
  error: MediaErrorGuidance | null;
  /** Flux local affiché dans l'aperçu (vidéo muette, écoute locale désactivée). */
  stream: MediaStream | null;
};

export type MediaPreviewController = {
  preferences: MediaPreferences;
  devices: MediaDevice[];
  status: MediaPreviewStatus;
  error: MediaErrorGuidance | null;
  meter: MicMeter;
  stream: MediaStream | null;
  /** Bascule le micro ou la caméra (état persisté). */
  toggle: (kind: "microphone" | "camera") => void;
  /** Choisit un périphérique (caméra, micro, sortie audio). */
  selectDevice: (kind: MediaDeviceKind, deviceId: string) => void;
  /** Relance la capture après une erreur. */
  retry: () => void;
};

function browserStorage(): MediaPreferencesStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Mesure le niveau du micro à partir du flux local (RMS d'un analyseur) et
 * renvoie une fonction d'arrêt. La mesure n'est jamais conservée ni envoyée :
 * elle ne sert qu'au vu-mètre.
 */
function startMicMeter(stream: MediaStream, onMeasure: (level: number) => void): () => void {
  const track = stream.getAudioTracks()[0];
  if (!track) return () => {};
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return () => {};

  let raf = 0;
  let context: AudioContext | null = null;
  try {
    context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let total = 0;
      for (const sample of samples) total += sample * sample;
      onMeasure(Math.sqrt(total / samples.length));
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    // Analyse indisponible (contexte audio refusé) : pas de vu-mètre, la
    // capture reste utilisable.
    return () => {};
  }

  return () => {
    cancelAnimationFrame(raf);
    void context?.close().catch(() => {});
  };
}

/**
 * Aperçu des périphériques de l'écran préparatoire : capture locale, liste des
 * périphériques, vu-mètre et erreurs traduites en français.
 *
 * L'état (micro/caméra, choix des périphériques) est conservé dans le stockage
 * local afin d'être proposé d'une réunion à l'autre.
 */
export function useMediaPreview(): MediaPreviewController {
  const storage = useRef<MediaPreferencesStorage | null>(null);
  if (storage.current === null) storage.current = browserStorage();

  const [preferences, setPreferences] = useState<MediaPreferences>(() =>
    loadMediaPreferences(storage.current),
  );
  const [devices, setDevices] = useState<readonly MediaDevice[]>([]);
  const [status, setStatus] = useState<MediaPreviewStatus>("starting");
  const [error, setError] = useState<MediaErrorGuidance | null>(null);
  const [bars, setBars] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [attempt, setAttempt] = useState(0);

  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const devicesRef = useRef<readonly MediaDevice[]>(devices);
  devicesRef.current = devices;
  const speakingRef = useRef(false);

  const apply = useCallback((next: MediaPreferences) => {
    preferencesRef.current = next;
    setPreferences(next);
    saveMediaPreferences(storage.current, next);
  }, []);

  /** Lit la liste des périphériques et corrige un choix qui n'existe plus. */
  const refreshDevices = useCallback(async () => {
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    try {
      const list = normalizeDevices(await media.enumerateDevices());
      devicesRef.current = list;
      setDevices(list);

      const current = preferencesRef.current;
      const lost = (kind: MediaDeviceKind, id: string | null) =>
        id !== null && !list.some((device) => device.kind === kind && device.deviceId === id);
      if (
        lost("camera", current.cameraDeviceId) ||
        lost("microphone", current.microphoneDeviceId)
      ) {
        apply({
          ...current,
          cameraDeviceId: resolveDeviceId("camera", list, current.cameraDeviceId),
          microphoneDeviceId: resolveDeviceId("microphone", list, current.microphoneDeviceId),
        });
      }
    } catch {
      // Énumération indisponible : la liste reste telle quelle.
    }
  }, [apply]);

  const { cameraOn, microphoneOn, cameraDeviceId, microphoneDeviceId } = preferences;

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  // `attempt` (bouton « Réessayer ») rejoue volontairement la capture : il doit
  // figurer dans les dépendances sans être lu dans le corps de l'effet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` est le compteur de relance, il doit rejouer la capture.
  useEffect(() => {
    if (!cameraOn && !microphoneOn) {
      setStatus("off");
      setError(null);
      setBars(0);
      setSpeaking(false);
      speakingRef.current = false;
      setStream(null);
      return;
    }

    let cancelled = false;
    let captured: MediaStream | null = null;
    let stopMeter: (() => void) | null = null;

    const fail = (guidance: MediaErrorGuidance) => {
      setError(guidance);
      setStatus(guidance.kind === "denied" ? "blocked" : "unavailable");
      setStream(null);
      setBars(0);
      setSpeaking(false);
    };

    void (async () => {
      const target = cameraOn ? "camera" : "microphone";
      const failure = mediaCaptureFailure({
        mediaDevices: navigator.mediaDevices,
        isSecureContext: window.isSecureContext,
      });
      if (failure) {
        fail(guidanceFor(failure, target));
        return;
      }

      setStatus("starting");
      setError(null);
      try {
        const local = await navigator.mediaDevices.getUserMedia({
          video: cameraOn ? captureConstraints("camera", cameraDeviceId) : false,
          audio: microphoneOn ? captureConstraints("microphone", microphoneDeviceId) : false,
        });
        if (cancelled) {
          local.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }
        captured = local;
        setStream(local);
        setStatus("live");
        await refreshDevices();

        stopMeter = startMicMeter(local, (level) => {
          setBars(activeLevelBars(normalizeRms(level)));
          const nextSpeaking = speakingState(speakingRef.current, normalizeRms(level));
          if (nextSpeaking !== speakingRef.current) {
            speakingRef.current = nextSpeaking;
            setSpeaking(nextSpeaking);
          }
        });
      } catch (caught) {
        if (cancelled) return;
        fail(describeMediaError(target, caught));
      }
    })();

    return () => {
      cancelled = true;
      stopMeter?.();
      captured?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, [cameraOn, microphoneOn, cameraDeviceId, microphoneDeviceId, refreshDevices, attempt]);

  const toggle = useCallback(
    (kind: "microphone" | "camera") => {
      apply(toggledMedia(preferencesRef.current, kind));
    },
    [apply],
  );

  const selectDevice = useCallback(
    (kind: MediaDeviceKind, deviceId: string) => {
      apply(withDevice(preferencesRef.current, kind, deviceId));
    },
    [apply],
  );

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return {
    preferences,
    devices: [...devices],
    status,
    error,
    meter: { bars, levelLabel: micLevelLabel(bars), speaking },
    stream,
    toggle,
    selectDevice,
    retry,
  };
}
