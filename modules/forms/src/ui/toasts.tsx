import { Button, cn, IconClose, type ToastTone, ToastViewport } from "@workspace/ui";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

/** Durée d'affichage d'un message simple (6 s). */
const DISMISS_MS = 6000;

/**
 * Fenêtre d'annulation : plus longue qu'un message ordinaire, pour laisser le
 * temps de lire la question supprimée, relire, puis cliquer.
 */
export const UNDO_WINDOW_MS = 8000;

/** Action rattachée à un message (bouton « Annuler »). */
export type FormsToastAction = {
  label: string;
  run: () => void;
};

export type FormsToastItem = {
  id: number;
  tone: ToastTone;
  message: string;
  action?: FormsToastAction;
  durationMs: number;
};

export type FormsToastsController = {
  toasts: FormsToastItem[];
  /** Message simple (information, succès, échec). */
  push: (tone: ToastTone, message: string) => void;
  /** Message suivi d'un bouton d'annulation (`« Question supprimée. Annuler »`). */
  pushUndo: (message: string, undo: () => void) => void;
  dismiss: (id: number) => void;
};

/**
 * Pile de messages du module Forms — même rendu que les toasts partagés
 * (`ToastViewport`, tons sémantiques, fermeture automatique), avec la seule
 * brique qui manque côté `@workspace/ui` : une action d'annulation.
 */
export function useFormsToasts(): FormsToastsController {
  const [toasts, setToasts] = useState<FormsToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const add = useCallback(
    (item: Omit<FormsToastItem, "id">) => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((current) => [...current, { ...item, id }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), item.durationMs),
      );
    },
    [dismiss],
  );

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      add({ tone, message, durationMs: DISMISS_MS });
    },
    [add],
  );

  const pushUndo = useCallback(
    (message: string, undo: () => void) => {
      add({
        tone: "info",
        message,
        action: { label: "Annuler", run: undo },
        durationMs: UNDO_WINDOW_MS,
      });
    },
    [add],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { toasts, push, pushUndo, dismiss };
}

export type FormsToastsProps = {
  toasts: FormsToastItem[];
  dismiss: (id: number) => void;
};

/**
 * Rend la pile de messages. Le bouton d'action, quand il existe, s'exécute
 * puis referme le message : l'annulation est une seule action, sans état
 * résiduel.
 */
export function FormsToasts({ toasts, dismiss }: FormsToastsProps): ReactNode {
  return (
    <ToastViewport>
      {toasts.map((toast) => {
        const action = toast.action;
        return (
          <div
            key={toast.id}
            role={toast.tone === "danger" ? "alert" : "status"}
            className={cn(
              "flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-lift",
              toast.tone === "danger" ? "text-destructive" : undefined,
            )}
          >
            <span className="min-w-0 flex-1">{toast.message}</span>
            {action ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="-mr-1 h-7 shrink-0 px-2 text-xs"
                onClick={() => {
                  action.run();
                  dismiss(toast.id);
                }}
              >
                {action.label}
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Fermer"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconClose />
            </button>
          </div>
        );
      })}
    </ToastViewport>
  );
}
