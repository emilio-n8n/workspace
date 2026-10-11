import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "../cn.ts";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Sans rembourrage interne (palettes, contenus qui gèrent leur mise en page). */
  bare?: boolean;
};

/**
 * Dialogue modal basé sur l'élément natif <dialog> :
 * focus trap, fermeture Échap et sémantique fournis par la plateforme.
 */
export function Dialog({ open, onClose, title, children, footer, className, bare }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

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
      className={cn(
        "w-full max-w-md rounded-xl border border-border bg-card p-0 text-card-foreground shadow-lift backdrop:bg-foreground/30",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-display text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="text-muted-foreground transition-colors hover:text-foreground"
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
      <div className={bare ? undefined : "px-4 py-4"}>{children}</div>
      {footer ? (
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>
      ) : null}
    </dialog>
  );
}
