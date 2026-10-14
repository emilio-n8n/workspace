/**
 * Signaux de frappe (« en train d'écrire ») — bus en mémoire, par canal.
 *
 * Même parti que la cloche de notifications (`@workspace/notifications`) : le
 * bus ne vit que dans le processus courant. Derrière plusieurs instances (ou
 * après un redémarrage), un signal peut ne pas être diffusé — la dégradation
 * est sûre : l'indicateur disparaît, jamais le message.
 *
 * Aucune écriture en base (un indicateur de frappe n'est pas une donnée
 * métier), aucune dépendance navigateur : ce module est utilisé par le service,
 * la route SSE et se teste seul sous Node.
 */

/** Signal de frappe reçu d'un membre connecté. */
export type TypingSignal = {
  channelId: string;
  userId: string;
  /** Nom affiché — résolu côté serveur, jamais depuis l'entrée client. */
  name: string;
  /** Horodatage de réception (ms) : l'expiration en découle. */
  at: number;
};

/** Personne en train d'écrire, vu par le client. */
export type TypingUser = {
  userId: string;
  name: string;
  at: number;
};

/** Durée de validité d'un signal : au-delà, la personne est considérée arrêtée. */
export const TYPING_TTL_MS = 5000;
/** Espacement minimal entre deux signaux de la même personne (anti-flot). */
export const TYPING_MIN_INTERVAL_MS = 1000;
/** Nombre maximal de signaux conservés par canal (borne mémoire). */
export const TYPING_MAX_PER_CHANNEL = 50;

/** Signaux actifs par canal : `channelId` → `userId` → signal. */
const signalsByChannel = new Map<string, Map<string, TypingSignal>>();
/** Dernier signal accepté par couple canal + utilisateur (anti-flot). */
const lastAcceptedAt = new Map<string, number>();

function keyOf(channelId: string, userId: string): string {
  return `${channelId}\u0000${userId}`;
}

/** Vrai si le couple (canal, utilisateur) a déjà émis dans l'intervalle minimum. */
export function isThrottled(
  channelId: string,
  userId: string,
  now: number,
  minInterval: number = TYPING_MIN_INTERVAL_MS,
): boolean {
  const last = lastAcceptedAt.get(keyOf(channelId, userId));
  return last !== undefined && now - last < minInterval;
}

/**
 * Enregistre un signal de frappe. Retourne `false` si le signal est écarté
 * (anti-flot) : l'appelant n'a alors rien à rediffuser.
 */
export function publishTyping(signal: TypingSignal): boolean {
  if (isThrottled(signal.channelId, signal.userId, signal.at)) return false;
  lastAcceptedAt.set(keyOf(signal.channelId, signal.userId), signal.at);

  let signals = signalsByChannel.get(signal.channelId);
  if (!signals) {
    signals = new Map();
    signalsByChannel.set(signal.channelId, signals);
  }
  signals.set(signal.userId, signal);
  // Borne mémoire : on garde les plus récents, jamais plus de 50 par canal.
  if (signals.size > TYPING_MAX_PER_CHANNEL) {
    const oldest = [...signals.values()]
      .sort((a, b) => a.at - b.at)
      .slice(0, signals.size - TYPING_MAX_PER_CHANNEL);
    for (const stale of oldest) signals.delete(stale.userId);
  }
  return true;
}

/** Signale l'arrêt de la frappe (envoi, départ du canal) : le signal est retiré. */
export function stopTyping(channelId: string, userId: string): void {
  const signals = signalsByChannel.get(channelId);
  if (!signals) return;
  signals.delete(userId);
  if (signals.size === 0) signalsByChannel.delete(channelId);
}

/** Signaux encore valides d'un canal, du plus récent au plus ancien. */
export function activeTypingSignals(
  channelId: string,
  now: number = Date.now(),
  ttl: number = TYPING_TTL_MS,
): TypingSignal[] {
  const signals = signalsByChannel.get(channelId);
  if (!signals) return [];
  const fresh = [...signals.values()].filter((signal) => now - signal.at < ttl);
  if (fresh.length === 0) {
    // Plus rien de valide : la table du canal est libérée immédiatement.
    signalsByChannel.delete(channelId);
    return [];
  }
  return fresh.sort((a, b) => b.at - a.at);
}

/**
 * Ne garde que les signaux non expirés — utilisé par le client, qui ne reçoit
 * pas d'évènement « arrêt » (l'expiration fait le ménage).
 */
export function pruneTypingUsers<T extends { at: number }>(
  users: readonly T[],
  now: number,
  ttl: number = TYPING_TTL_MS,
): T[] {
  return users.filter((user) => now - user.at < ttl);
}

/**
 * Libellé de l'indicateur. Une personne : « Alice est en train d'écrire… » ;
 * deux : « Alice et Bruno sont en train d'écrire… » ; au-delà de trois, on
 * compte (« 4 personnes écrivent… ») plutôt que d'énumérer.
 */
export function formatTypingStatus(names: readonly string[]): string {
  const unique = [...new Set(names.filter((name) => name.trim().length > 0))];
  if (unique.length === 0) return "";
  const [first, second, third] = unique;
  if (unique.length === 1) return `${first} est en train d'écrire…`;
  if (unique.length === 2) return `${first} et ${second} sont en train d'écrire…`;
  if (unique.length === 3) return `${first}, ${second} et ${third} sont en train d'écrire…`;
  return `${unique.length} personnes écrivent…`;
}
