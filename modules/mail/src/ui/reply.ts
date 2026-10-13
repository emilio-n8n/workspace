/**
 * Préparation d'une réponse — règles pures, testées sans navigateur : objet
 * (préfixe « Re: » ajouté une seule fois) et citation du message d'origine.
 */

/** Préfixe d'une réponse déjà présent (« Re: », « re : », « RE : »…). */
const REPLY_PREFIX = /^\s*re\s*:\s*/i;

/** Objet de la réponse : jamais de « Re: Re: ». */
export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  if (trimmed.length === 0) return "Re:";
  return REPLY_PREFIX.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/**
 * Corps de la réponse : citation en retrait, précédée d'une ligne vide et d'une
 * attribution. Les lignes vides ne sont pas citées à vide (« > » seul).
 */
export function quoteOriginal(message: {
  fromName?: string | null;
  fromAddress: string;
  body: string;
}): string {
  const author = message.fromName?.trim() || message.fromAddress;
  const quoted = message.body
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"))
    .join("\n");
  return `\n\n— ${author} a écrit :\n${quoted}`;
}

/**
 * Réponse à tous : l'expéditeur d'origine plus les destinataires, dédupliqués,
 * sans la personne qui répond.
 */
export function replyAllRecipients(message: {
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  responder: string;
}): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const address of [message.fromAddress, ...message.toAddresses, ...message.ccAddresses]) {
    const normalized = address.trim().toLowerCase();
    if (normalized.length === 0) continue;
    if (normalized === message.responder.trim().toLowerCase()) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** Copies de la réponse à tous : les destinataires en copie d'origine. */
export function replyAllCopies(message: { ccAddresses: string[]; responder: string }): string[] {
  return message.ccAddresses
    .map((address) => address.trim().toLowerCase())
    .filter(
      (address, index, list) =>
        address.length > 0 &&
        address !== message.responder.trim().toLowerCase() &&
        list.indexOf(address) === index,
    );
}
