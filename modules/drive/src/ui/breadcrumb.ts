/**
 * Fil d'Ariane : découpage du chemin en segments affichés, segments masqués
 * regroupés dans un menu, et libellés français.
 *
 * Fonctions pures (test/breadcrumb.test.ts) : l'interface se contente de rendre
 * le résultat.
 */

/** Niveau affiché dans le fil (racine comprise), au-delà duquel les segments intermédiaires sont repliés. */
export const MAX_TRAIL_SEGMENTS = 3;

/** Libellé de la racine du Drive. */
export const ROOT_TRAIL_LABEL = "Mon Drive";

export type Crumb = { id: string; name: string };

export type TrailParts<T> = {
  /** Segments toujours affichés en tête (le premier est la racine). */
  leading: T[];
  /** Segments repliés dans le menu de débordement. */
  overflow: T[];
  /** Segments toujours affichés en fin de fil (le dernier est le dossier courant). */
  trailing: T[];
};

/**
 * Découpe un chemin trop long : la racine et les derniers segments restent
 * visibles, les segments intermédiaires passent dans un menu « … ».
 *
 * Un chemin de `maxSegments` segments ou moins est affiché en entier.
 */
export function splitTrail<T>(
  items: readonly T[],
  maxSegments = MAX_TRAIL_SEGMENTS,
): TrailParts<T> {
  if (items.length <= maxSegments) {
    return { leading: [...items], overflow: [], trailing: [] };
  }
  const tailCount = Math.max(1, maxSegments - 1);
  return {
    leading: items.slice(0, 1),
    overflow: items.slice(1, items.length - tailCount),
    trailing: items.slice(items.length - tailCount),
  };
}

/**
 * Segments du fil d'Ariane d'un dossier : le dossier courant est toujours le
 * dernier segment affiché (c'est lui qui porte `aria-current`), et la racine
 * reste toujours visible. `maxSegments` compte les segments hors débordement.
 */
export function trailParts(
  crumbs: readonly Crumb[],
  maxSegments = MAX_TRAIL_SEGMENTS,
): TrailParts<Crumb> {
  if (crumbs.length === 0) return { leading: [], overflow: [], trailing: [] };

  const current = crumbs[crumbs.length - 1] as Crumb;
  const ancestors = crumbs.slice(0, -1);
  const split = splitTrail(ancestors, Math.max(1, maxSegments - 1));
  return {
    leading: split.leading,
    overflow: split.overflow,
    trailing: [...split.trailing, current],
  };
}

/** Chemin complet, lu par les lecteurs d'écran à la place du fil replié. */
export function trailLabel(crumbs: readonly Crumb[], rootLabel = ROOT_TRAIL_LABEL): string {
  return [rootLabel, ...crumbs.map((crumb) => crumb.name)].join(" / ");
}

/** Intitulé du bouton de débordement, accordé au nombre de dossiers masqués. */
export function overflowLabel(count: number): string {
  return count <= 1 ? "Afficher 1 dossier masqué" : `Afficher ${count} dossiers masqués`;
}

/** Intitulé du menu de navigation vers les sous-dossiers du dossier courant. */
export const SUBFOLDER_MENU_LABEL = "Aller à un sous-dossier";
