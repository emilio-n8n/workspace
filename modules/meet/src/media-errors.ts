/**
 * Traduction des erreurs de périphériques en français actionnable.
 *
 * Le navigateur renvoie des `DOMException` techniques (`NotAllowedError`,
 * `NotReadableError`…) : afficher le message brut ne dit pas à la personne ce
 * qu'elle doit faire. Chaque erreur devient donc un titre lisible et une action
 * concrète, à afficher avec le bouton « Réessayer ».
 */

export type MediaErrorKind = "denied" | "missing" | "busy" | "insecure" | "unsupported" | "unknown";

export type MediaErrorGuidance = {
  kind: MediaErrorKind;
  title: string;
  action: string;
};

export type MediaTarget = "microphone" | "camera" | "output";

const NAMES: Record<MediaErrorKind, readonly string[]> = {
  denied: ["NotAllowedError", "PermissionDeniedError"],
  missing: ["NotFoundError", "DevicesNotFoundError", "OverconstrainedError"],
  busy: ["NotReadableError", "TrackStartError", "AbortError"],
  insecure: ["SecurityError"],
  unsupported: ["NotSupportedError", "TypeError"],
  unknown: [],
};

function errorName(error: unknown): string {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name;
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/** Classe d'erreur indépendante du libellé exact du navigateur. */
export function recognizeMediaError(error: unknown): MediaErrorKind {
  const name = errorName(error);
  for (const [kind, names] of Object.entries(NAMES) as [MediaErrorKind, readonly string[]][]) {
    if (names.includes(name)) return kind;
  }
  return "unknown";
}

const TITLES: Record<MediaErrorKind, Record<MediaTarget, string>> = {
  denied: {
    microphone: "Accès au micro refusé",
    camera: "Accès à la caméra refusé",
    output: "Changement de sortie audio refusé",
  },
  missing: {
    microphone: "Aucun micro détecté",
    camera: "Aucune caméra détectée",
    output: "Aucune sortie audio disponible",
  },
  busy: {
    microphone: "Micro déjà utilisé",
    camera: "Caméra déjà utilisée",
    output: "Sortie audio indisponible",
  },
  insecure: {
    microphone: "Connexion non sécurisée",
    camera: "Connexion non sécurisée",
    output: "Connexion non sécurisée",
  },
  unsupported: {
    microphone: "Micro incompatible avec ce navigateur",
    camera: "Caméra incompatible avec ce navigateur",
    output: "Sortie audio incompatible avec ce navigateur",
  },
  unknown: {
    microphone: "Micro indisponible",
    camera: "Caméra indisponible",
    output: "Sortie audio indisponible",
  },
};

const ACTIONS: Record<MediaErrorKind, string> = {
  denied:
    "Autorisez l'accès dans les réglages du navigateur (icône ou message dans la barre d'adresse), puis réessayez.",
  missing: "Branchez un périphérique, choisissez-le dans la liste ci-dessous, puis réessayez.",
  busy: "Fermez les autres onglets ou applications qui utilisent ce périphérique, puis réessayez.",
  insecure: "Ouvrez la réunion depuis une adresse en HTTPS, puis réessayez.",
  unsupported: "Utilisez une version à jour de Chrome, Firefox, Edge ou Safari, puis réessayez.",
  unknown: "Vérifiez le périphérique, puis réessayez dans quelques instants.",
};

/** Conseil complet pour une classe d'erreur et une cible données. */
export function guidanceFor(kind: MediaErrorKind, target: MediaTarget): MediaErrorGuidance {
  return { kind, title: TITLES[kind][target], action: ACTIONS[kind] };
}

/** Dérive un conseil actionnable depuis l'exception levée par le navigateur. */
export function describeMediaError(target: MediaTarget, error: unknown): MediaErrorGuidance {
  return guidanceFor(recognizeMediaError(error), target);
}

/** Support de la capture dans l'environnement courant (`null` = tout va bien). */
export function mediaCaptureFailure(environment: {
  mediaDevices?: unknown;
  isSecureContext?: boolean;
}): MediaErrorKind | null {
  const devices = environment.mediaDevices as MediaDevices | undefined;
  if (!devices || typeof devices.getUserMedia !== "function") return "unsupported";
  if (environment.isSecureContext === false) return "insecure";
  return null;
}
