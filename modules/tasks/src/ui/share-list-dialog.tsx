import { Badge, Button, Dialog, Label } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type ListGrantView,
  listMembersFn,
  listTaskListGrantsFn,
  type MemberView,
  shareTaskListFn,
  type TaskListView,
  unshareTaskListFn,
} from "../server.ts";

type Props = {
  list: TaskListView | null;
  open: boolean;
  onClose: () => void;
  onShared: () => Promise<void>;
};

const ROLE_LABELS: Record<string, string> = {
  viewer: "Lecture",
  commenter: "Commentaire",
  editor: "Édition",
  owner: "Propriétaire",
};

/** Partage d'une liste de tâches avec les membres de l'organisation. */
export function ShareListDialog({ list, open, onClose, onShared }: Props) {
  const [members, setMembers] = useState<MemberView[]>([]);
  const [grants, setGrants] = useState<ListGrantView[]>([]);
  const [selected, setSelected] = useState("");
  const [role, setRole] = useState<"viewer" | "commenter" | "editor">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!list) return;
    const [memberRows, grantRows] = await Promise.all([
      listMembersFn(),
      listTaskListGrantsFn({ data: { listId: list.id } }),
    ]);
    setMembers(memberRows);
    setGrants(grantRows);
  }, [list]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelected("");
    void refresh();
  }, [open, refresh]);

  async function onShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!list || selected === "") return;

    setBusy(true);
    setError(null);
    try {
      await shareTaskListFn({ data: { listId: list.id, userId: selected, role } });
      setSelected("");
      await refresh();
      await onShared();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Partage impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(grantId: string) {
    if (!list) return;
    setBusy(true);
    try {
      await unshareTaskListFn({ data: { listId: list.id, grantId } });
      await refresh();
      await onShared();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={list ? `Partager « ${list.name} »` : "Partager"}
      className="max-w-xl"
    >
      <div className="flex flex-col gap-5">
        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Cette liste est privée : personne d'autre n'y a accès.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {grants.map((grant) => (
              <li key={grant.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{grant.subjectLabel}</span>
                <Badge variant="outline">{ROLE_LABELS[grant.role] ?? grant.role}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void onRemove(grant.id)}
                  aria-label={`Retirer l'accès de ${grant.subjectLabel}`}
                >
                  Retirer
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={onShare} method="post" className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-2">
            <Label htmlFor="share-member">Membre</Label>
            <select
              id="share-member"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Choisir un membre…</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name} ({member.email})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="share-list-role">Droit</Label>
            <select
              id="share-list-role"
              value={role}
              onChange={(event) => setRole(event.target.value as "viewer" | "commenter" | "editor")}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="viewer">Lecture</option>
              <option value="commenter">Commentaire</option>
              <option value="editor">Édition</option>
            </select>
          </div>
          <Button type="submit" loading={busy} disabled={selected === ""}>
            Partager
          </Button>
        </form>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
