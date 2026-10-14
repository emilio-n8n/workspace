import { Button, ToastViewport } from "@workspace/ui";

export type SlideUndoToastProps = {
  /** Message court décrivant l'action annulable. */
  message: string;
  /** Rétablit l'état d'avant l'action. */
  onUndo: () => void;
  /** Ferme le message sans rétablir. */
  onDismiss: () => void;
};

/**
 * Message d'annulation d'une action sur les diapositives (suppression,
 * duplication). Réutilise la zone de toasts du design system : pile en bas à
 * droite, au-dessus du contenu, jetons sémantiques uniquement.
 */
export function SlideUndoToast({ message, onUndo, onDismiss }: SlideUndoToastProps) {
  return (
    <ToastViewport>
      <div
        role="status"
        className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-lift"
      >
        <span className="min-w-0 flex-1">{message}</span>
        <Button size="sm" variant="outline" onClick={onUndo}>
          Annuler
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fermer le message"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          ✕
        </button>
      </div>
    </ToastViewport>
  );
}
