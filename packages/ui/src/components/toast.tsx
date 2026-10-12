import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../cn.ts";

/** Durée d'affichage d'un toast avant fermeture automatique (6 s). */
const AUTO_DISMISS_MS = 6000;

export type ToastTone = "info" | "success" | "danger";

export type ToastItem = {
  id: number;
  tone: ToastTone;
  message: string;
};

export type UseToastsResult = {
  toasts: ToastItem[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
};

export type ToastViewportProps = {
  children: ReactNode;
};

/** Zone d'affichage des toasts — pile fixée en bas à droite, au-dessus du contenu. */
export function ToastViewport({ children }: ToastViewportProps) {
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {children}
    </div>
  );
}

export type ToastsProps = {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
};

/**
 * Pile de toasts prête à l'emploi — rend le résultat de `useToasts` dans la
 * zone d'affichage (tonalité danger en rouge, fermeture manuelle par ✕).
 */
export function Toasts({ toasts, dismiss }: ToastsProps) {
  return (
    <ToastViewport>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "danger" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-lift",
            toast.tone === "danger" ? "text-destructive" : undefined,
          )}
        >
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="Fermer"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            ✕
          </button>
        </div>
      ))}
    </ToastViewport>
  );
}

/**
 * Gestionnaire de toasts sans dépendance — à utiliser dans le composant
 * consommateur : `const { toasts, push, dismiss } = useToasts()` puis
 * `<Toasts toasts={toasts} dismiss={dismiss} />`. Fermeture auto après 6 s.
 */
export function useToasts(): UseToastsResult {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
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

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((current) => [...current, { id, tone, message }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}
