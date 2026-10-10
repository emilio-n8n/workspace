import { Badge, Button, Dialog, Input, Label } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  createShareLinkFn,
  type DriveEntryView,
  type GrantView,
  listGrantsFn,
  listShareLinksFn,
  revokeShareLinkFn,
  type ShareLinkView,
  shareByEmailFn,
  unshareFn,
} from "../../server/drive";

type Props = {
  entry: DriveEntryView | null;
  open: boolean;
  onClose: () => void;
};

const ROLE_LABELS: Record<string, string> = {
  viewer: "Lecture",
  commenter: "Commentaire",
  editor: "Édition",
  owner: "Propriétaire",
};

/**
 * Partage d'un élément : membres de l'organisation (rôles) + liens publics
 * révocables. Les jetons de lien ne sont affichés qu'à la création.
 */
export function ShareDialog({ entry, open, onClose }: Props) {
  const [grants, setGrants] = useState<GrantView[]>([]);
  const [links, setLinks] = useState<ShareLinkView[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "commenter" | "editor">("viewer");
  const [linkRole, setLinkRole] = useState<"viewer" | "editor">("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!entry) return;
    const [nextGrants, nextLinks] = await Promise.all([
      listGrantsFn({ data: { entryId: entry.id } }),
      listShareLinksFn({ data: { entryId: entry.id } }),
    ]);
    setGrants(nextGrants);
    setLinks(nextLinks);
  }, [entry]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCreatedUrl(null);
    setCopied(false);
    void refresh();
  }, [open, refresh]);

  async function onShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entry) return;

    const clean = email.trim().toLowerCase();
    if (clean.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      await shareByEmailFn({ data: { entryId: entry.id, email: clean, role } });
      setEmail("");
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Partage impossible : la personne doit être membre de l'organisation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveGrant(grantId: string) {
    if (!entry) return;
    setBusy(true);
    try {
      await unshareFn({ data: { entryId: entry.id, grantId } });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onCreateLink() {
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      const link = await createShareLinkFn({ data: { entryId: entry.id, role: linkRole } });
      setCreatedUrl(`${window.location.origin}/s/${link.token}`);
      setCopied(false);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création du lien impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onRevokeLink(linkId: string) {
    setBusy(true);
    try {
      await revokeShareLinkFn({ data: { linkId } });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={entry ? `Partager « ${entry.name} »` : "Partager"}
      className="max-w-xl"
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Membres de l'organisation
          </h3>

          {grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Personne d'autre n'a accès pour le moment.
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
                    onClick={() => void onRemoveGrant(grant.id)}
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
              <Label htmlFor="share-email">E-mail du membre</Label>
              <Input
                id="share-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="collegue@organisation.org"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="share-role">Droit</Label>
              <select
                id="share-role"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as "viewer" | "commenter" | "editor")
                }
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="viewer">Lecture</option>
                <option value="commenter">Commentaire</option>
                <option value="editor">Édition</option>
              </select>
            </div>
            <Button type="submit" loading={busy} disabled={email.trim().length === 0}>
              Partager
            </Button>
          </form>
        </section>

        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Lien de partage (sans compte)
          </h3>

          {createdUrl ? (
            <div className="flex flex-col gap-2 rounded-md border border-primary bg-accent/40 p-3">
              <p className="text-xs text-muted-foreground">
                Copiez ce lien maintenant — le jeton ne sera plus affiché.
              </p>
              <code className="block overflow-x-auto font-mono text-xs">{createdUrl}</code>
              <div>
                <Button size="sm" variant="outline" onClick={() => void onCopy()}>
                  {copied ? "Copié !" : "Copier le lien"}
                </Button>
              </div>
            </div>
          ) : null}

          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun lien créé.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {links.map((link) => (
                <li key={link.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <Badge variant={link.revokedAt ? "default" : "accent"}>
                    {link.revokedAt ? "Révoqué" : (ROLE_LABELS[link.role] ?? link.role)}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    Créé le{" "}
                    {new Date(link.createdAt).toLocaleDateString("fr-FR", { dateStyle: "medium" })}
                    {link.lastUsedAt
                      ? ` · dernier accès ${new Date(link.lastUsedAt).toLocaleString("fr-FR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}`
                      : " · jamais utilisé"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || Boolean(link.revokedAt)}
                    onClick={() => void onRevokeLink(link.id)}
                  >
                    Révoquer
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="link-role">Droit du lien</Label>
              <select
                id="link-role"
                value={linkRole}
                onChange={(event) => setLinkRole(event.target.value as "viewer" | "editor")}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="viewer">Lecture</option>
                <option value="editor">Édition</option>
              </select>
            </div>
            <Button variant="outline" loading={busy} onClick={() => void onCreateLink()}>
              Créer un lien
            </Button>
          </div>
        </section>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
