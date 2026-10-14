/**
 * Recherche dans le document — logique pure.
 *
 * La recherche porte sur le texte du document, pas sur l'affichage : on
 * parcourt les nœuds de texte avec leurs positions ProseMirror, on assemble un
 * texte continu, puis on reporte chaque occurrence dans le document. Les
 * positions trouvées alimentent à la fois les surlignages (décorations) et le
 * compteur — même fonction, donc impossible que l'un mente sur l'autre.
 *
 * Tout est testable sans navigateur : aucun accès au DOM ici.
 */

/** Tranche de texte du document, avec sa position ProseMirror. */
export type TextSlice = {
  text: string;
  /** Position du premier caractère dans le document. */
  from: number;
  /** Position juste après le dernier caractère. */
  to: number;
};

/** Occurrence trouvée : bornes ProseMirror, prêtes pour une décoration. */
export type SearchMatch = {
  from: number;
  to: number;
};

/**
 * Nœud minimal pour parcourir un document : `Node` de ProseMirror le satisfait,
 * et un double de test aussi. `offset` décale les positions rendues — il sert
 * aux doubles de test, qui n'ont pas de position absolue propre.
 */
export type WalkableNode = {
  isText: boolean;
  isLeaf?: boolean;
  text?: string;
  nodeSize: number;
  descendants: (visit: (node: WalkableNode, pos: number) => unknown, offset?: number) => void;
};

/** Séparateur entre blocs : évite qu'une recherche joigne deux paragraphes. */
const BLOCK_SEPARATOR = "\n";

/**
 * Tranches de texte du document, une par suite ininterrompue de texte à
 * l'intérieur d'un même bloc.
 *
 * Une frontière de bloc (ou une feuille comme une image ou un saut de ligne)
 * coupe la tranche : rechercher « fin du paragraphe 1 début du 2 » ne doit rien
 * trouver, mais « gras » traversant deux portions de texte d'un même
 * paragraphe (séparées par un changement de style) doit être trouvé.
 */
export function collectTextSlices(doc: WalkableNode): TextSlice[] {
  const slices: TextSlice[] = [];
  let pending: { text: string; from: number; to: number } | null = null;

  const flush = () => {
    if (pending && pending.text.length > 0) {
      slices.push({ text: pending.text, from: pending.from, to: pending.to });
    }
    pending = null;
  };

  doc.descendants((node, pos) => {
    if (node.isText) {
      pending ??= { text: "", from: pos, to: pos };
      pending.text += node.text ?? "";
      // ProseMirror compte en unités UTF-16 : `nodeSize` d'un texte est sa longueur.
      pending.to = pos + node.nodeSize;
      return false;
    }
    // Tout ce qui n'est pas du texte clôt la tranche en cours.
    flush();
    return undefined;
  });

  // Dernière tranche : rien ne vient la clore après le parcours.
  flush();
  return slices;
}

/**
 * Cherche `query` dans les tranches et rend les occurrences en positions
 * ProseMirror.
 *
 * - requête vide : aucune occurrence (on ne surligne pas tout le document) ;
 * - insensible à la casse et aux accents par défaut (la recherche d'un
 *   traitement de texte ne fait pas distinguer « ÉTÉ » de « été ») ;
 * - une occurrence ne dépasse jamais d'un bloc à l'autre.
 */
export function findMatches(
  slices: readonly TextSlice[],
  query: string,
  options: { caseSensitive?: boolean; foldAccents?: boolean } = {},
): SearchMatch[] {
  const caseSensitive = options.caseSensitive ?? false;
  const foldAccents = options.foldAccents ?? true;
  const needle = normalize(query, { caseSensitive, foldAccents });
  if (needle.length === 0) return [];

  // Texte continu du document, et pour chacun de ses caractères la position
  // ProseMirror correspondante — `null` aux frontières entre blocs.
  const pieces: string[] = [];
  const positions: (number | null)[] = [];

  for (const [index, slice] of slices.entries()) {
    if (index > 0) {
      pieces.push(BLOCK_SEPARATOR);
      positions.push(null);
    }
    // Caractère par caractère (unités UTF-16, comme les positions ProseMirror) :
    // la normalisation d'un caractère seul ne change jamais sa longueur d'une
    // unité à l'autre, donc texte et positions restent alignés.
    for (let offset = 0; offset < slice.text.length; offset += 1) {
      const folded = normalize(slice.text[offset] ?? "", { caseSensitive, foldAccents });
      if (folded.length === 0) continue;
      pieces.push(folded);
      positions.push(slice.from + offset);
    }
  }

  const haystack = pieces.join("");
  const matches: SearchMatch[] = [];
  let cursor = haystack.indexOf(needle);

  while (cursor !== -1) {
    const from = positions[cursor];
    // Fin de l'occurrence : un caractère après le dernier trouvé. Une unité
    // repliée sur plusieurs morceaux garde la même position, donc ce calcul
    // reste juste.
    const last = positions[cursor + needle.length - 1];
    if (
      from !== null &&
      from !== undefined &&
      last !== null &&
      last !== undefined &&
      from < last + 1
    ) {
      matches.push({ from, to: last + 1 });
    }
    // +1 : une occurrence peut en chevaucher une autre (« aa » dans « aaa »).
    cursor = haystack.indexOf(needle, cursor + 1);
  }

  return matches;
}

/**
 * Normalise une chaîne pour la comparaison. La casse et les accents sont
 * repliés par défaut : « ÉTÉ » trouve « été ». Les blancs sont préservés — une
 * recherche avec espaces doit rester précise.
 */
function normalize(
  value: string,
  options: { caseSensitive: boolean; foldAccents: boolean },
): string {
  let result = value;
  if (options.foldAccents) result = result.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (!options.caseSensitive) result = result.toLowerCase();
  return result;
}

/**
 * Index de l'occurrence suivante, en boucle : après la dernière on revient à la
 * première. Un compteur à zéro reste à zéro.
 */
export function nextMatchIndex(current: number, total: number, step = 1): number {
  if (total <= 0) return 0;
  const target = current + step;
  return ((target % total) + total) % total;
}

/**
 * Cadre un index d'occurrence dans les bornes : un collaborateur qui efface du
 * texte, un document qui rétrécit — l'index actif ne doit jamais sortir de la
 * liste.
 */
export function clampMatchIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(current, 0), total - 1);
}

/**
 * Libellé du compteur, en français : « Aucune occurrence », « 1 occurrence »,
 * « Occurrence 2 sur 5 ». L'index est rendu en base 1 — un lecteur d'écran
 * annonce « 2 sur 5 », jamais « 1 sur 5 » pour la deuxième.
 */
export function formatMatchCounter(current: number, total: number): string {
  if (total <= 0) return "Aucune occurrence";
  if (total === 1) return "1 occurrence";
  return `Occurrence ${clampMatchIndex(current, total) + 1} sur ${total}`;
}

/**
 * Message d'absence de résultat, précis et utile : il nomme le terme cherché
 * pour qu'un lecteur d'écran comprenne ce qui échoue.
 */
export function formatNoMatch(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) return "";
  return `Aucune occurrence pour « ${trimmed} »`;
}
