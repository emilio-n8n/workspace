import { FileIcon } from "@workspace/ui";
import type { SubmissionAttachmentMeta } from "../server.ts";
import { fmtSize } from "./format.ts";

/**
 * Liens de téléchargement des pièces jointes d'une copie : le binaire passe par
 * la route dédiée (session requise), jamais par la charge utile JSON. La liste
 * est exposée comme telle (`<ul>`/`<li>`), chaque lien nommé par son fichier et
 * sa taille lue par les lecteurs d'écran.
 */
export function AttachmentLinks({ attachments }: { attachments: SubmissionAttachmentMeta[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Pièces jointes de la copie" className="flex flex-wrap gap-x-4 gap-y-1">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <a
            href={`/api/classroom/attachments/${attachment.id}`}
            className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
          >
            <FileIcon
              kind="file"
              mimeType={attachment.contentType}
              name={attachment.filename}
              className="shrink-0"
            />
            {attachment.filename}
            <span className="text-muted-foreground">({fmtSize(attachment.sizeBytes)})</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
