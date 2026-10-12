/**
 * Limiteur de débit en mémoire, à fenêtre fixe.
 *
 * L'implémentation est volontairement pure et sans dépendance : les compteurs
 * vivent dans une `Map` du processus appelant.
 *
 * LIMITE MONO-INSTANCE : chaque instance du serveur possède son propre
 * compteur. Déployé sur N instances (ou N contextes serverless), la limite
 * effective est donc N × `max` — c'est un premier rempart contre l'abus, pas
 * un quota strict. Le palier suivant documenté est un backend partagé (table
 * base de données ou Redis) branché derrière la même interface `check()`,
 * sans changer les appelants.
 */

/** Résultat d'une consommation : autorisée, ou refusée avec le délai d'attente. */
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type CounterEntry = { windowStart: number; count: number };

/** Au-delà de ce nombre de compteurs, les entrées expirées sont élaguées. */
const PRUNE_THRESHOLD = 1_000;

export type RateLimiter = {
  /**
   * Consomme une unité pour `key`. `now` (ms depuis l'époque) est injectable
   * pour des tests déterministes ; par défaut `Date.now()`.
   */
  check(key: string, now?: number): RateLimitResult;
  /** Diagnostic : nombre de compteurs actuellement en mémoire. */
  size(): number;
};

/**
 * Crée un limiteur à fenêtre fixe : au plus `max` passages par `windowMs` et
 * par clé. Voir l'avertissement mono-instance en tête de fichier.
 */
export function createRateLimiter(options: { windowMs: number; max: number }): RateLimiter {
  if (!(options.windowMs > 0) || !(options.max > 0)) {
    throw new Error("createRateLimiter : windowMs et max doivent être strictement positifs.");
  }

  const counters = new Map<string, CounterEntry>();

  /** Fenêtre alignée sur l'époque : bornes stables et prévisibles. */
  function windowStartFor(now: number): number {
    return Math.floor(now / options.windowMs) * options.windowMs;
  }

  /**
   * Élagage paresseux : déclenché uniquement quand la table dépasse le seuil,
   * pour garder la mémoire bornée sans coût à chaque appel.
   */
  function prune(now: number): void {
    if (counters.size <= PRUNE_THRESHOLD) return;
    for (const [key, counter] of counters) {
      if (counter.windowStart + options.windowMs <= now) {
        counters.delete(key);
      }
    }
  }

  return {
    check(key, now = Date.now()): RateLimitResult {
      prune(now);

      const windowStart = windowStartFor(now);
      const counter = counters.get(key);

      if (!counter || counter.windowStart !== windowStart) {
        counters.set(key, { windowStart, count: 1 });
        return { allowed: true };
      }

      if (counter.count < options.max) {
        counter.count += 1;
        return { allowed: true };
      }

      const remainingMs = windowStart + options.windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1_000)) };
    },
    size(): number {
      return counters.size;
    },
  };
}
