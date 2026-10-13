/**
 * Préférences d'entrée (micro, caméra, sortie audio) — logique pure, sans accès
 * au navigateur : chaque règle est testable et partagée entre l'écran
 * préparatoire et la salle de réunion.
 *
 * Les valeurs sont conservées dans le stockage local du navigateur afin qu'une
 * personne retrouve son micro et sa caméra d'une réunion à l'autre, sans
 * nouvelle demande de permission.
 */

export type MediaDeviceKind = "camera" | "microphone" | "speaker";

export type MediaPreferences = {
  /** Micro ouvert au moment d'entrer. */
  microphoneOn: boolean;
  /** Caméra ouverte au moment d'entrer. */
  cameraOn: boolean;
  /** Périphérique choisi, `null` = laisser le navigateur décider. */
  microphoneDeviceId: string | null;
  cameraDeviceId: string | null;
  speakerDeviceId: string | null;
};

export type MediaPreferencesStorage = Pick<Storage, "getItem" | "setItem">;

export const MEDIA_PREFERENCES_KEY = "meet.media-preferences.v1";

export const DEFAULT_MEDIA_PREFERENCES: MediaPreferences = {
  microphoneOn: true,
  cameraOn: true,
  microphoneDeviceId: null,
  cameraDeviceId: null,
  speakerDeviceId: null,
};

/** Périphérique normalisé : identifiant stable, type sémantique, libellé lisible. */
export type MediaDevice = {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
};

export const DEVICE_ID_KEY: Record<
  MediaDeviceKind,
  "cameraDeviceId" | "microphoneDeviceId" | "speakerDeviceId"
> = {
  camera: "cameraDeviceId",
  microphone: "microphoneDeviceId",
  speaker: "speakerDeviceId",
};

const KIND_LABELS: Record<MediaDeviceKind, string> = {
  camera: "Caméra",
  microphone: "Micro",
  speaker: "Sortie audio",
};

/** Champ `kind` d'un MediaDeviceInfo du navigateur → type sémantique. */
const INPUT_KIND_BY_DEVICE_KIND: Record<string, MediaDeviceKind> = {
  videoinput: "camera",
  audioinput: "microphone",
  audiooutput: "speaker",
};

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && (value === "true" || value === "false")) {
    return value === "true";
  }
  return fallback;
}

/** Ramène n'importe quelle valeur persistée à un jeu de préférences cohérent. */
export function sanitizeMediaPreferences(input: unknown): MediaPreferences {
  if (typeof input !== "object" || input === null) return DEFAULT_MEDIA_PREFERENCES;
  const raw = input as Record<string, unknown>;
  return {
    microphoneOn: cleanBoolean(raw.microphoneOn, DEFAULT_MEDIA_PREFERENCES.microphoneOn),
    cameraOn: cleanBoolean(raw.cameraOn, DEFAULT_MEDIA_PREFERENCES.cameraOn),
    microphoneDeviceId: cleanId(raw.microphoneDeviceId),
    cameraDeviceId: cleanId(raw.cameraDeviceId),
    speakerDeviceId: cleanId(raw.speakerDeviceId),
  };
}

/**
 * Lit les préférences du stockage local. Toute valeur absente ou corrompue
 * retombe sur les valeurs par défaut — jamais d'exception au chargement.
 */
export function loadMediaPreferences(
  storage: MediaPreferencesStorage | null | undefined,
): MediaPreferences {
  if (!storage) return DEFAULT_MEDIA_PREFERENCES;
  let raw: string | null = null;
  try {
    raw = storage.getItem(MEDIA_PREFERENCES_KEY);
  } catch {
    return DEFAULT_MEDIA_PREFERENCES;
  }
  if (raw === null) return DEFAULT_MEDIA_PREFERENCES;
  try {
    return sanitizeMediaPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_MEDIA_PREFERENCES;
  }
}

export function saveMediaPreferences(
  storage: MediaPreferencesStorage | null | undefined,
  preferences: MediaPreferences,
): void {
  if (!storage) return;
  try {
    storage.setItem(MEDIA_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Stockage indisponible (navigation privée, quota) : les préférences de la
    // session en cours restent valables, on n'interrompt pas la réunion.
  }
}

/** Bascule un état marche/arrêt sans muter l'objet reçu. */
export function toggledMedia(
  preferences: MediaPreferences,
  kind: "microphone" | "camera",
): MediaPreferences {
  if (kind === "microphone") {
    return { ...preferences, microphoneOn: !preferences.microphoneOn };
  }
  return { ...preferences, cameraOn: !preferences.cameraOn };
}

/** Associe une préférence de périphérique à son type. */
export function withDevice(
  preferences: MediaPreferences,
  kind: MediaDeviceKind,
  deviceId: string | null,
): MediaPreferences {
  return { ...preferences, [DEVICE_ID_KEY[kind]]: cleanId(deviceId) };
}

/** Libellé lisible d'un type de périphérique (labels, messages d'erreur). */
export function mediaKindLabel(kind: MediaDeviceKind): string {
  return KIND_LABELS[kind];
}

/**
 * Libellé affiché : tant que la permission n'est pas accordée, le navigateur
 * renvoie un `label` vide — on propose alors un nom numéroté en français.
 */
export function formatDeviceLabel(kind: MediaDeviceKind, label: string, position: number): string {
  const trimmed = label.trim();
  if (trimmed.length > 0) return trimmed;
  return `${KIND_LABELS[kind]} ${position + 1}`;
}

/** Normalise les MediaDeviceInfo du navigateur (types stables, libellés FR). */
export function normalizeDevices(devices: readonly MediaDeviceInfo[]): MediaDevice[] {
  const counters: Record<MediaDeviceKind, number> = { camera: 0, microphone: 0, speaker: 0 };
  const normalized: MediaDevice[] = [];
  for (const device of devices) {
    const kind = INPUT_KIND_BY_DEVICE_KIND[device.kind];
    if (!kind) continue;
    const position = counters[kind];
    counters[kind] += 1;
    normalized.push({
      deviceId: device.deviceId,
      kind,
      label: formatDeviceLabel(kind, device.label, position),
    });
  }
  return normalized;
}

/**
 * Périphérique retenu pour un type donné : le choix enregistré s'il est encore
 * branché, sinon le premier disponible — jamais un identifiant disparu.
 */
export function resolveDeviceId(
  kind: MediaDeviceKind,
  devices: readonly MediaDevice[],
  preferredId: string | null,
): string | null {
  const sameKind = devices.filter((device) => device.kind === kind);
  if (preferredId !== null && sameKind.some((device) => device.deviceId === preferredId)) {
    return preferredId;
  }
  return sameKind[0]?.deviceId ?? null;
}

/** Périphérique effectivement retenu (pour l'affichage de la sélection). */
export function resolveDevice(
  kind: MediaDeviceKind,
  devices: readonly MediaDevice[],
  preferredId: string | null,
): MediaDevice | null {
  const deviceId = resolveDeviceId(kind, devices, preferredId);
  if (deviceId === null) return null;
  return devices.find((device) => device.kind === kind && device.deviceId === deviceId) ?? null;
}

/** Contraintes de capture pour un type donné (identifiant vide = périphérique par défaut). */
export function captureConstraints(
  kind: "microphone" | "camera",
  deviceId: string | null,
): MediaTrackConstraints {
  const constraint: MediaTrackConstraints =
    deviceId === null ? {} : { deviceId: { exact: deviceId } };
  if (kind === "microphone") {
    return { ...constraint, echoCancellation: true, noiseSuppression: true };
  }
  return { ...constraint, width: { ideal: 1280 }, height: { ideal: 720 } };
}
