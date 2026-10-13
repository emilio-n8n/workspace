import { cn, Input, Label } from "@workspace/ui";
import { useId } from "react";
import {
  ATTACHMENT_BUDGET_BYTES,
  attachmentStatusLabel,
  budgetLabel,
  type ComposerAttachment,
  formatFileSize,
  hasFailedUpload,
  MAX_ATTACHMENT_SLOTS,
  progressBarProps,
  readProgress,
} from "./attachments.ts";

export type ComposerAttachmentsProps = {
  attachments: ComposerAttachment[];
  disabled?: boolean;
  /** Fichiers choisis : le parent décide du téléversement. */
  onPick: (files: File[]) => void;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  onRetryAll: () => void;
};

/**
 * Panneau des pièces jointes du compositeur : jauge d'occupation, état de
 * chaque fichier (lecture, téléversement, prêt, échec) et reprise d'un envoi
 * échoué sans perdre le fichier ni son contexte.
 */
export function ComposerAttachments({
  attachments,
  disabled = false,
  onPick,
  onRemove,
  onRetry,
  onRetryAll,
}: ComposerAttachmentsProps) {
  const inputId = useId();
  const usage = attachments.length / MAX_ATTACHMENT_SLOTS;
  const gauge = progressBarProps(usage, "Occupation des pièces jointes");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId}>Pièces jointes</Label>
        {hasFailedUpload(attachments) ? (
          <button
            type="button"
            onClick={onRetryAll}
            disabled={disabled}
            className="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
          >
            Tout réessayer
          </button>
        ) : null}
      </div>

      <Input
        id={inputId}
        type="file"
        multiple
        disabled={disabled}
        aria-label="Choisir des pièces jointes"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          onPick(files);
        }}
        className="h-auto py-1.5"
      />

      <p className="text-xs text-muted-foreground">
        {MAX_ATTACHMENT_SLOTS} fichiers,{" "}
        {formatFileSize(ATTACHMENT_BUDGET_BYTES / MAX_ATTACHMENT_SLOTS)} chacun au maximum.
      </p>

      {attachments.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div {...gauge} className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted")}>
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                usage >= 1 ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${Math.round(usage * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">{budgetLabel(attachments)}</p>

          <ul className="flex flex-col gap-1">
            {attachments.map((attachment) => (
              <li
                key={attachment.key}
                className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={attachment.name}>
                    {attachment.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatFileSize(attachment.sizeBytes)}
                  </span>
                  {attachment.phase === "error" ? (
                    <button
                      type="button"
                      onClick={() => onRetry(attachment.key)}
                      disabled={disabled}
                      className="shrink-0 font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      Réessayer
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Retirer ${attachment.name}`}
                    onClick={() => onRemove(attachment.key)}
                    disabled={disabled}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                  >
                    ✕
                  </button>
                </div>

                {attachment.phase === "reading" || attachment.phase === "uploading" ? (
                  <div
                    {...progressBarProps(
                      readProgress(attachment),
                      `Avancement de ${attachment.name}`,
                    )}
                    className="h-1 w-full overflow-hidden rounded-full bg-background"
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${Math.round(readProgress(attachment) * 100)}%` }}
                    />
                  </div>
                ) : null}

                <p
                  className={cn(
                    "text-[11px]",
                    attachment.phase === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                  role={attachment.phase === "error" ? "alert" : undefined}
                >
                  {attachmentStatusLabel(attachment)}
                  {attachment.phase === "reading" || attachment.phase === "uploading"
                    ? ` · ${Math.round(readProgress(attachment) * 100)} %`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
