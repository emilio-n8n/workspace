import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  IconVideo,
  Input,
  Label,
  PageHeader,
  Toasts,
  useToasts,
} from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { createRoomFn, deleteRoomFn, listRoomsFn, type RoomView } from "../server.ts";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Liste des salles de visioconférence de l'organisation. */
export function MeetView() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [roomToDelete, setRoomToDelete] = useState<RoomView | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const refresh = useCallback(async () => {
    try {
      setRooms(await listRoomsFn());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length === 0) return;
    setBusy(true);
    try {
      const created = await createRoomFn({ data: { name: name.trim() } });
      setName("");
      setDialogOpen(false);
      await refresh();
      await navigate({ to: "/room/$slug", params: { slug: created.slug } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(slug: string) {
    setBusy(true);
    try {
      await deleteRoomFn({ data: { slug } });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!roomToDelete) return;
    await onDelete(roomToDelete.slug);
    setRoomToDelete(null);
  }

  async function copyLink(slug: string) {
    await navigator.clipboard?.writeText(`${window.location.origin}/room/${slug}`);
    push("success", "Copié !");
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Visioconférences"
        description="Salles persistantes avec lien — le média passe par votre serveur LiveKit (optionnel)."
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            Nouvelle salle
          </Button>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : rooms.length === 0 ? (
        <EmptyState
          icon={<IconVideo />}
          title="Aucune salle pour le moment."
          hint="Créez-en une et partagez son lien."
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              Nouvelle salle
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rooms.map((room) => (
            <li
              key={room.slug}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-semibold">{room.name}</p>
                <p className="text-xs text-muted-foreground">
                  /room/{room.slug} · créée le {formatDate(room.createdAt)} ·{" "}
                  {room.requireAdmission ? "entrée sur admission" : "entrée libre"}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void copyLink(room.slug)}>
                Copier le lien
              </Button>
              <Button
                size="sm"
                onClick={() => void navigate({ to: "/room/$slug", params: { slug: room.slug } })}
              >
                Rejoindre
              </Button>
              {room.mine ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  loading={busy}
                  onClick={() => setRoomToDelete(room)}
                >
                  Supprimer
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Toasts toasts={toasts} dismiss={dismiss} />

      <ConfirmDialog
        open={roomToDelete !== null}
        onClose={() => setRoomToDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={`Supprimer la salle « ${roomToDelete?.name ?? ""} » ?`}
        message="Cette salle et son lien seront supprimés."
        destructive
        busy={busy}
      />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nouvelle salle">
        <form onSubmit={onCreate} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="room-name">Nom de la salle</Label>
            <Input
              id="room-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Réunion hebdo"
              maxLength={120}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={name.trim().length === 0}>
              Créer la salle
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
