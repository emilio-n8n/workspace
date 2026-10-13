/**
 * Plan du document : titres, niveaux, position courante et navigation clavier.
 *
 * Toute la logique est ici, hors React et hors ProseMirror — le panneau
 * `outline-panel.tsx` ne fait que l'afficher. Les fonctions sont testées avec
 * des documents au format stocké (`PmNode`, voir `export.ts`).
 */

/** Entrée du plan : un titre du document et sa place dans la structure. */
export type OutlineHeading = {
  /** Niveau borné (1 à 6) : pilote l'indentation du plan. */
  level: number;
  /** Texte du titre, normalisé. */
  text: string;
  /** Position du nœud titre dans le document ProseMirror. */
  pos: number;
};

/**
 * Niveau d'un titre, borné à 1…6 : un document peut venir d'un autre éditeur
 * (niveau absent, texte, flottant, hors bornes). Tout défaut retombe sur 1.
 */
export function headingLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), 6);
}

/** Texte d'un titre : espaces réduits, marges retirées (les titres sont courts). */
export function outlineTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Libellé affiché dans le plan. Un titre vide (curseur posé puis `H2`) reste
 * visible et annoncé : repli explicite plutôt qu'une ligne muette.
 */
export function outlineLabel(text: string): string {
  return outlineTitle(text) || "Titre vide";
}

/**
 * Indentation d'une entrée, en pas Tailwind : deux titres de même niveau sont
 * alignés, chaque niveau décale le titre suivant. Les six valeurs sont écrites
 * en dur — Tailwind ne génère pas les classes assemblées à l'exécution.
 */
const INDENT_CLASSES = ["pl-0", "pl-3", "pl-6", "pl-9", "pl-12", "pl-15"] as const;

export function outlineIndentClass(level: number): string {
  return INDENT_CLASSES[Math.min(Math.max(level, 1), 6) - 1] ?? "pl-0";
}

/**
 * Index du titre qui contient la position `from` — le dernier titre situé à ou
 * avant le curseur (les titres ne s'imbriquent pas, donc un seul peut
 * « contenir » une position). `-1` quand le curseur précède tout titre.
 */
export function activeHeadingIndex(headings: readonly OutlineHeading[], from: number): number {
  let active = -1;
  for (const [index, heading] of headings.entries()) {
    if (heading.pos > from) break;
    active = index;
  }
  return active;
}

/**
 * Déplacement dans le plan au clavier (`↑` / `↓`, `Début` / `Fin` via un delta
 * borné) : sort d'une sélection vide et ne dépasse jamais les bornes.
 */
export function stepHeadingIndex(current: number, delta: number, count: number): number {
  if (count === 0) return -1;
  const target = current < 0 ? (delta > 0 ? 0 : count - 1) : current + delta;
  return Math.min(Math.max(target, 0), count - 1);
}

/**
 * Index du dernier titre dont le haut est passé au-dessus du repère de lecture
 * (`offset` en pixels sous le haut de la zone de défilement) : c'est la section
 * que lit l'utilisateur. `-1` avant le premier titre, ou si le repère n'est pas
 * encore atteint.
 */
export function activeFromTops(tops: readonly number[], offset: number): number {
  let active = -1;
  for (const [index, top] of tops.entries()) {
    if (top - offset > 0) break;
    active = index;
  }
  return active;
}

/**
 * Vrai si deux plans sont identiques — évite de reconstruire le panneau à chaque
 * frappe, alors que seule la position du curseur a changé.
 */
export function sameOutline(a: readonly OutlineHeading[], b: readonly OutlineHeading[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((heading, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      other.level === heading.level &&
      other.text === heading.text &&
      other.pos === heading.pos
    );
  });
}
