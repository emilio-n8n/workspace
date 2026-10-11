import { useNavigate } from "@tanstack/react-router";
import { Button, Dialog, Input, Label } from "@workspace/ui";
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
  const [copied, setCopied] = useState<string | null>(null);

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

  async function copyLink(slug: string) {
    await navigator.clipboard?.writeText(`${window.location.origin}/room/${slug}`);
    setCopied(slug);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Visioconférences</h1>
          <p className="text-sm text-muted-foreground">
            Salles persistantes avec lien — le média passe par votre serveur LiveKit (optionnel).
          </p>
        </div>
        <Button className="ml-auto" size="sm" onClick={() => setDialogOpen(true)}>
          Nouvelle salle
        </Button>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : rooms.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Aucune salle pour le moment. Créez-en une et partagez son lien.
          </p>
        </div>
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
                  /room/{room.slug} · créée le {formatDate(room.createdAt)}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void copyLink(room.slug)}>
                {copied === room.slug ? "Copié !" : "Copier le lien"}
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
                  onClick={() => void onDelete(room.slug)}
                >
                  Supprimer
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

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
