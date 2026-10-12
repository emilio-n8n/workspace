import type { ReactNode } from "react";
import { Button } from "./button.tsx";
import { Dialog } from "./dialog.tsx";

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  /** Libellé du bouton de confirmation (défaut : « Confirmer »). */
  confirmLabel?: string;
  /** Désactive les actions et affiche un indicateur sur le bouton de confirmation. */
  busy?: boolean;
  /** Style la confirmation en rouge (action irréversible). */
  destructive?: boolean;
};

/**
 * Dialogue de confirmation — question bloquante avec action « Annuler » (ghost)
 * et confirmation (primaire, ou bordure rouge si destructive) en état de chargement.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirmer",
  busy = false,
  destructive = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            variant={destructive ? "outline" : "primary"}
            className={destructive ? "text-destructive" : undefined}
            onClick={onConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted-foreground">{message}</div>
    </Dialog>
  );
}
