/**
 * Publication d'un site (TASK-005) : état publié / brouillon et libellés
 * associés. Module pur — le service décide de ce qui change en base,
 * l'interface ne fait que mettre en forme.
 *
 * Les dates sont rendues en **UTC** : la même valeur s'affiche à l'identique
 * quel que soit le fuseau du serveur ou du poste, ce qui rend les tests (et
 * deux écrans ouverts côte à côte) cohérents.
 */

export type PublishState = { publishedAt: string | null };

/** Un site est en ligne dès qu'une date de publication valide existe. */
export function isPublished(publishedAt: string | null): boolean {
  return formatPublishedDate(publishedAt) !== null;
}

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat("fr-FR", { timeStyle: "short", timeZone: "UTC" });

/**
 * Date de publication lisible, ou `null` si le site est un brouillon (ou si la
 * valeur en base est illisible).
 */
export function formatPublishedDate(publishedAt: string | null): string | null {
  if (publishedAt === null) return null;
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${DATE.format(date)} à ${TIME.format(date)}`;
}

/** Tonalité du badge d'état (`Badge` de `@workspace/ui`). */
export type PublishTone = "accent" | "default";

export type PublishStatus = {
  tone: PublishTone;
  label: string;
  /** Phrase d'explication, annoncée avec l'état. */
  detail: string;
};

/** État affiché du site : brouillon ou publié, avec sa date. */
export function publishStatus(publishedAt: string | null): PublishStatus {
  const date = formatPublishedDate(publishedAt);
  if (date === null) {
    return {
      tone: "default",
      label: "Brouillon",
      detail: "Ce site n'est pas en ligne : vous seul le voyez.",
    };
  }
  return {
    tone: "accent",
    label: "Publié",
    detail: `En ligne depuis le ${date} (UTC).`,
  };
}

/** Libellé du bouton d'action : publier, ou republier pour prendre les modifications. */
export function publishActionLabel(publishedAt: string | null): string {
  return isPublished(publishedAt) ? "Republier" : "Publier";
}
