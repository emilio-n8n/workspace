/** Formatage français partagé par les écrans du cours — une seule vérité. */

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

/** Date courte (« 12 oct. 2026 »), `null` si absente ou illisible. */
export function formatDate(iso: string | null): string | null {
  const date = parse(iso);
  if (!date) return null;
  return date.toLocaleDateString("fr-FR", DATE_OPTIONS);
}

/** Date et heure (« 12 oct. 2026 à 14:05 »), `null` si absente ou illisible. */
export function formatDateTime(iso: string | null): string | null {
  const date = parse(iso);
  if (!date) return null;
  return `${date.toLocaleDateString("fr-FR", DATE_OPTIONS)} à ${date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Échéance lisible : la date, ou « sans échéance » quand il n'y en a pas. */
export function formatDueDate(iso: string | null): string {
  return formatDate(iso) ?? "sans échéance";
}

/** Taille de fichier en unités binaires (« 12,4 Ko »). */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Valeur d'un `<input type="date">` (AAAA-MM-JJ) dans le fuseau local : ce que
 * l'utilisateur voit à l'écran, pas la date UTC d'un instant.
 */
export function toDateInputValue(iso: string | null): string {
  const date = parse(iso);
  if (!date) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Instant échéance (`AAAA-MM-JJ`) -> ISO à 23:59 locale, fin de journée. */
export function dueDateInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Retard d'une copie en jours entiers (une minute de retard compte un jour de
 * retard), `null` quand la copie est rendue à l'heure ou sans échéance.
 */
export function daysLate(submittedAt: string, dueAt: string | null): number | null {
  if (!dueAt) return null;
  const submitted = new Date(submittedAt).getTime();
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(submitted) || Number.isNaN(due) || submitted <= due) return null;
  return Math.ceil((submitted - due) / 86_400_000);
}

/** Lit un fichier local en base64 (sans préfixe data:) pour le serveur. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Lecture de « ${file.name} » impossible.`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) {
        reject(new Error(`Lecture de « ${file.name} » impossible.`));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Date valide, ou `null` : mieux vaut rien afficher qu'une date inventée. */
function parse(iso: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
