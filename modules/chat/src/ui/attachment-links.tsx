import type { AttachmentMeta, MessageView } from "../server.ts";
import { fmtSize } from "./format.ts";
import { IconPaperclip } from "./icons.tsx";

/**
 * Pièces jointes d'un message — liens de téléchargement servis par la route
 * dédiée (le binaire ne transite jamais par le JSON des server functions).
 * Le nom et la taille sont annoncés : un trombonne seul ne dit pas ce que
 * l'on télécharge.
 */
export function AttachmentLinks({ attachments }: { attachments: AttachmentMeta[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <a
            href={`/api/chat/attachments/${attachment.id}`}
            className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
          >
            <IconPaperclip className="size-3.5" />
            {attachment.filename}{" "}
            <span className="opacity-70">({fmtSize(attachment.sizeBytes)})</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Résumé textuel des pièces jointes — utilisé dans les panneaux (épingles). */
export function attachmentSummary(attachments: MessageView["attachments"]): string | null {
  if (attachments.length === 0) return null;
  const names = attachments.map((attachment) => attachment.filename);
  return names.length === 1
    ? `1 pièce jointe : ${names[0]}`
    : `${names.length} pièces jointes : ${names.join(", ")}`;
}
