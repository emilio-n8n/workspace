import { foldText } from "./text.ts";

/**
 * Mentions @utilisateur : détection du jeton en cours de frappe, classement des
 * candidats, insertion, et découpage d'un message pour l'affichage.
 *
 * Règles communes : un « @ » ne commence une mention qu'en tête de mot (un
 * « a@b » est une adresse, pas une mention) et un nom peut contenir lettres,
 * chiffres, point, tiret, apostrophe droite ou typographique.
 */

/** Personne susceptible d'être mentionnée. */
export type MentionCandidate = {
  id: string;
  name: string;
  email: string;
};

/** Mention en cours de frappe : borne sur le texte et requête tapée. */
export type MentionToken = {
  /** Texte déjà tapé après le « @ » (peut être vide). */
  query: string;
  /** Position du « @ ». */
  start: number;
  /** Fin du mot commencé (au-delà du curseur si le curseur est au milieu). */
  end: number;
};

/** Morceau de message : texte brut ou mention. */
export type MentionSegment = {
  text: string;
  mention: boolean;
};

/** Nombre maximal de suggestions affichées (au-delà, la liste gêne la saisie). */
export const MENTION_LIMIT = 6;

const NAME_CHARACTER = /[\p{L}\p{N}._\u2019'-]/u;
/** Ponctuation de fin de nom : « @ali. » mentionne « ali », pas « ali. ». */
const NAME_TAIL = /[.'\u2019-]+$/;

function isNameCharacter(character: string | undefined): boolean {
  return character !== undefined && NAME_CHARACTER.test(character);
}

/** Nom mentionné nettoyé de sa ponctuation de fin. */
function cleanName(raw: string): string {
  return raw.replace(NAME_TAIL, "");
}

/**
 * Mentions présentes dans un message : bornes `[début, fin)` de chaque `@nom`.
 * Sert à l'affichage (puces) autant qu'à l'extraction des noms cités.
 */
export function mentionRanges(body: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== "@") continue;
    // « @ » collé à un mot (« a@b ») : adresse électronique, pas une mention.
    if (isNameCharacter(body[index - 1])) continue;
    let end = index + 1;
    while (end < body.length && isNameCharacter(body[end])) end += 1;
    if (end === index + 1) continue;
    const name = cleanName(body.slice(index + 1, end));
    if (name.length === 0) continue;
    ranges.push([index, index + 1 + name.length]);
    index = index + name.length;
  }
  return ranges;
}

/** Noms mentionnés dans un message, dans l'ordre d'apparition, sans doublon. */
export function extractMentionNames(body: string): string[] {
  const names: string[] = [];
  for (const [start, end] of mentionRanges(body)) {
    const name = body.slice(start + 1, end);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Découpe un message en texte brut et mentions, dans l'ordre — c'est ce qui
 * permet de rendre une puce cliquable autour de `@Nom` sans casser les retours
 * à la ligne.
 */
export function splitMentionSegments(body: string): MentionSegment[] {
  const ranges = mentionRanges(body);
  if (ranges.length === 0) return [{ text: body, mention: false }];
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) segments.push({ text: body.slice(cursor, start), mention: false });
    segments.push({ text: body.slice(start, end), mention: true });
    cursor = end;
  }
  if (cursor < body.length) segments.push({ text: body.slice(cursor), mention: false });
  return segments;
}

/**
 * Mention en cours de frappe sous le curseur, ou `null` si le curseur n'est pas
 * dans une mention. Le jeton couvre le mot entier (curseur au milieu compris)
 * pour qu'une correction remplace bien tout le nom tapé.
 */
export function detectMentionToken(text: string, caret: number): MentionToken | null {
  if (caret < 0 || caret > text.length) return null;
  // Remonte au « @ » du mot en cours : tout caractère de nom est traversé, un
  // séparateur arrête la recherche (pas de mention en cours).
  let at = -1;
  for (let index = Math.min(caret, text.length) - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character === "@") {
      at = index;
      break;
    }
    if (isNameCharacter(character)) continue;
    return null;
  }
  if (at < 0) return null;
  // « @ » collé à un mot (« a@b ») : ce n'est pas une mention.
  if (isNameCharacter(text[at - 1])) return null;

  let end = at + 1;
  while (end < text.length && isNameCharacter(text[end])) end += 1;
  // Une espace (ou tout séparateur) après le nom clôt la mention : le curseur
  // est alors sorti du jeton.
  if (caret > end) return null;
  const name = cleanName(text.slice(at + 1, end));
  return { query: text.slice(at + 1, Math.min(caret, end)), start: at, end: at + 1 + name.length };
}

/**
 * Classe les candidats pour une requête : ceux dont le nom commence par la
 * requête d'abord, puis ceux qui la contiennent, le tout insensible à la casse
 * et aux accents (« eteint » trouve « Éteinte »). À requête vide, l'ordre
 * alphabétique français sert de repère.
 */
export function rankMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  limit: number = MENTION_LIMIT,
): MentionCandidate[] {
  const needle = foldText(query.trim());
  const scored = candidates
    .map((candidate) => {
      const name = foldText(candidate.name);
      if (needle.length === 0) return { candidate, score: 1 };
      const at = name.indexOf(needle);
      if (at < 0) return null;
      return { candidate, score: at === 0 ? 0 : 2 };
    })
    .filter((entry): entry is { candidate: MentionCandidate; score: number } => entry !== null);

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.candidate.name.localeCompare(b.candidate.name, "fr");
  });
  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.candidate);
}

/**
 * Remplace le jeton par `@Nom`. Une espace n'est ajoutée que si la phrase
 * continue par un mot (« @Alice suite ») ou s'arrête là (« @Alice ») — jamais
 * avant une ponctuation, jamais en double. Rend la nouvelle position du
 * curseur, juste après.
 */
export function applyMention(
  text: string,
  token: MentionToken,
  name: string,
): { text: string; caret: number } {
  const before = text.slice(0, token.start);
  const after = text.slice(token.end);
  const separator = after.length === 0 || NAME_CHARACTER.test(after[0] ?? "") ? " " : "";
  const caret = before.length + 1 + name.length + separator.length;
  return { text: `${before}@${name}${separator}${after}`, caret };
}
