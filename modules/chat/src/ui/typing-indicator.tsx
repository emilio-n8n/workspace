import { formatTypingStatus } from "../typing.ts";

/**
 * Indicateur « en train d'écrire » — ligne annoncée poliment au-dessus du
 * compositeur. Volontairement toujours présente dans le DOM (hauteur réservée)
 * pour que l'arrivée d'un indicateur ne fasse pas sauter la conversation.
 *
 * Portée : le signal vient du flux SSE du canal (`event: typing`) ou, en repli,
 * de l'interrogation courte — un déploiement multi-instances peut donc ne pas
 * diffuser l'indicateur. La dégradation est sûre : il disparaît, jamais le
 * message.
 */
export function TypingIndicator({ names }: { names: readonly string[] }) {
  const label = formatTypingStatus(names);
  return (
    <p
      aria-live="polite"
      data-testid="typing-indicator"
      className="min-h-5 px-4 pt-1 text-xs text-muted-foreground"
    >
      {label}
    </p>
  );
}
