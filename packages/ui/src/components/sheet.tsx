import { type ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "../cn.ts";

export type SheetSide = "right" | "left";

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Description optionnelle, associée par `aria-describedby`. */
  description?: string;
  /** Côté d'ouverture (défaut : droite). */
  side?: SheetSide;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/**
 * Panneau latéral — volet modal qui glisse depuis un bord de l'écran, bâti sur
 * l'élément natif `<dialog>` (focus piégé, fermeture par Échap, sémantique
 * fournis par la plateforme). Titre et description sont associés par
 * `aria-labelledby` / `aria-describedby` ; le corps défile seul.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  side = "right",
  children,
  footer,
  className,
}: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        "fixed inset-y-0 m-0 flex h-full max-h-none w-full max-w-md flex-col rounded-none border-border bg-card p-0 text-card-foreground shadow-lift backdrop:bg-overlay",
        side === "left" ? "left-0 rounded-r-xl" : "right-0 rounded-l-xl",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate font-display text-sm font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
      {footer ? (
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>
      ) : null}
    </dialog>
  );
}
