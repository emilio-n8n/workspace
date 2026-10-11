import type { ComponentType, SVGProps } from "react";
import { cn } from "./cn.ts";
import {
  IconArchive,
  IconFileText,
  IconFolder,
  IconGrid,
  IconImage,
  IconMusic,
  IconPresentation,
  IconVideo,
} from "./icons.tsx";

export const DOCS_MIME = "application/vnd.workspace.docs+json";

type Tone =
  | "file-folder"
  | "file-doc"
  | "file-sheet"
  | "file-slide"
  | "file-pdf"
  | "file-image"
  | "file-archive"
  | "file-audio"
  | "file-video"
  | "file-text"
  | "file-generic";

/** Classes Tailwind statiques (jamais construites dynamiquement). */
const TONE_CLASS: Record<Tone, string> = {
  "file-folder": "text-file-folder",
  "file-doc": "text-file-doc",
  "file-sheet": "text-file-sheet",
  "file-slide": "text-file-slide",
  "file-pdf": "text-file-pdf",
  "file-image": "text-file-image",
  "file-archive": "text-file-archive",
  "file-audio": "text-file-audio",
  "file-video": "text-file-video",
  "file-text": "text-file-text",
  "file-generic": "text-file-generic",
};

const SHEET_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",
  "text/csv",
];

const DOC_MIMES = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
  "application/rtf",
];

const SLIDE_MIMES = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.presentation",
];

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** Détermine icône et couleur d'après le type MIME (repli sur l'extension). */
export function fileVisual(input: {
  kind: "folder" | "file";
  mimeType: string | null;
  name: string;
}): { Icon: IconComponent; tone: Tone } {
  if (input.kind === "folder") return { Icon: IconFolder, tone: "file-folder" };

  const mime = input.mimeType ?? "";
  const extension = input.name.split(".").pop()?.toLowerCase() ?? "";

  if (
    mime === DOCS_MIME ||
    DOC_MIMES.includes(mime) ||
    ["doc", "docx", "odt", "rtf", "md"].includes(extension)
  ) {
    return { Icon: IconFileText, tone: "file-doc" };
  }
  if (SHEET_MIMES.includes(mime) || ["xlsx", "xls", "ods", "csv"].includes(extension)) {
    return { Icon: IconGrid, tone: "file-sheet" };
  }
  if (SLIDE_MIMES.includes(mime) || ["pptx", "ppt", "odp"].includes(extension)) {
    return { Icon: IconPresentation, tone: "file-slide" };
  }
  if (mime === "application/pdf" || extension === "pdf") {
    return { Icon: IconFileText, tone: "file-pdf" };
  }
  if (
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(extension)
  ) {
    return { Icon: IconImage, tone: "file-image" };
  }
  if (
    ["application/zip", "application/x-tar", "application/gzip", "application/x-7z-compressed"].includes(
      mime,
    ) ||
    ["zip", "tar", "gz", "7z", "rar"].includes(extension)
  ) {
    return { Icon: IconArchive, tone: "file-archive" };
  }
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "flac", "m4a"].includes(extension)) {
    return { Icon: IconMusic, tone: "file-audio" };
  }
  if (mime.startsWith("video/") || ["mp4", "webm", "mov", "mkv"].includes(extension)) {
    return { Icon: IconVideo, tone: "file-video" };
  }
  if (mime.startsWith("text/") || ["txt", "log", "json", "xml", "yaml", "yml"].includes(extension)) {
    return { Icon: IconFileText, tone: "file-text" };
  }
  return { Icon: IconFileText, tone: "file-generic" };
}

/** Icône colorée d'un élément Drive. */
export function FileIcon({
  kind,
  mimeType,
  name,
  className,
}: {
  kind: "folder" | "file";
  mimeType: string | null;
  name: string;
  className?: string;
}) {
  const { Icon, tone } = fileVisual({ kind, mimeType, name });
  return <Icon className={cn("size-4", TONE_CLASS[tone], className)} />;
}
