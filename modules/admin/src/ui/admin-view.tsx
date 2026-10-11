import { Badge, Button, Input, Label } from "@workspace/ui";
import { useCallback, useEffect, useState } from "react";
import {
  type AuditEntry,
  addMemberFn,
  getOverviewFn,
  listAuditFn,
  listMembersFn,
  type MemberFull,
  type OrgOverview,
  removeMemberFn,
  updateMemberRoleFn,
  updateOrgProfileFn,
  updateQuotaFn,
} from "../server.ts";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

const RESULT_LABELS: Record<string, { label: string; bad?: boolean }> = {
  success: { label: "Succès" },
  denied: { label: "Refusé", bad: true },
  error: { label: "Erreur", bad: true },
};

/**
 * Administration de l'organisation : profil, membres et rôles, quota de
 * stockage et journal d'audit. Réservé aux rôles owner/admin (vérifié côté
 * serveur — cet écran n'est qu'une vue).
 */
export function AdminView() {
  const [overview, setOverview] = useState<OrgOverview | null>(null);
  const [members, setMembers] = useState<MemberFull[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [orgName, setOrgName] = useState("");
  const [quotaGo, setQuotaGo] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [data, memberList, auditList] = await Promise.all([
        getOverviewFn(),
        listMembersFn(),
        listAuditFn(),
      ]);
      setOverview(data);
      setOrgName(data.org.name);
      setQuotaGo(data.quotaBytes ? String(Math.round(data.quotaBytes / 1024 ** 3)) : "");
      setMembers(memberList);
      setAudit(auditList);
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

  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(null), 2500);
  }

  async function guard(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      flash(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Administration</h1>
        <p className="text-sm text-muted-foreground">
          Organisation {overview?.org.slug} · {overview?.memberCount ?? 0} membre(s)
          {overview ? ` · ${overview.auditCount} événement(s) d'audit` : ""}
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h2 className="font-display text-sm font-semibold">Profil de l'organisation</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-64 flex-1 flex-col gap-1">
            <Label htmlFor="org-name">Nom</Label>
            <Input
              id="org-name"
              value={orgName}
              onChange={(event) => setOrgName(event.target.value)}
              maxLength={150}
            />
          </div>
          <Button
            size="sm"
            loading={busy}
            disabled={orgName.trim().length === 0 || orgName === overview?.org.name}
            onClick={() =>
              void guard(
                () => updateOrgProfileFn({ data: { name: orgName.trim() } }),
                "Profil mis à jour.",
              )
            }
          >
            Enregistrer
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h2 className="font-display text-sm font-semibold">Membres</h2>
        <ul className="flex flex-col divide-y divide-border">
          {members.map((entry) => (
            <li key={entry.userId} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{entry.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{entry.email}</span>
              </span>
              {entry.role === "owner" ? (
                <Badge>Propriétaire</Badge>
              ) : (
                <select
                  aria-label={`Rôle de ${entry.name}`}
                  value={entry.role}
                  disabled={busy}
                  onChange={(event) =>
                    void guard(
                      () =>
                        updateMemberRoleFn({
                          data: {
                            userId: entry.userId,
                            role: event.target.value as "admin" | "member",
                          },
                        }),
                      "Rôle mis à jour.",
                    )
                  }
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="member">Membre</option>
                  <option value="admin">Administrateur</option>
                </select>
              )}
              {entry.role !== "owner" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  loading={busy}
                  onClick={() =>
                    void guard(
                      () => removeMemberFn({ data: { userId: entry.userId } }),
                      "Membre retiré.",
                    )
                  }
                >
                  Retirer
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div className="flex min-w-64 flex-1 flex-col gap-1">
            <Label htmlFor="invite-email">Ajouter un compte existant par e-mail</Label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="collegue@exemple.org"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            loading={busy}
            disabled={inviteEmail.trim().length === 0}
            onClick={() =>
              void guard(async () => {
                await addMemberFn({ data: { email: inviteEmail.trim() } });
                setInviteEmail("");
              }, "Membre ajouté.")
            }
          >
            Ajouter
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h2 className="font-display text-sm font-semibold">Stockage</h2>
        <p className="text-sm text-muted-foreground">
          {overview
            ? `${formatBytes(overview.usedBytes)} utilisés · ${overview.fileCount} fichier(s)${
                overview.quotaBytes
                  ? ` · quota ${formatBytes(overview.quotaBytes)}`
                  : " · sans quota"
              }`
            : ""}
        </p>
        {overview?.quotaBytes ? (
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.min(100, (overview.usedBytes / overview.quotaBytes) * 100)}%`,
              }}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex w-40 flex-col gap-1">
            <Label htmlFor="quota">Quota (Go, vide = illimité)</Label>
            <Input
              id="quota"
              type="number"
              min={0}
              value={quotaGo}
              onChange={(event) => setQuotaGo(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            loading={busy}
            onClick={() =>
              void guard(
                () =>
                  updateQuotaFn({
                    data: {
                      quotaBytes: quotaGo.trim() ? Math.max(0, Number(quotaGo)) * 1024 ** 3 : null,
                    },
                  }),
                "Quota mis à jour.",
              )
            }
          >
            Appliquer
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h2 className="font-display text-sm font-semibold">Journal d'audit (100 derniers)</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun événement pour le moment.</p>
        ) : (
          <ul className="flex max-h-96 flex-col divide-y divide-border overflow-y-auto">
            {audit.map((entry) => {
              const result = RESULT_LABELS[entry.result] ?? { label: entry.result };
              return (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-mono text-xs">{entry.action}</span>
                  {entry.resourceType ? (
                    <span className="text-xs text-muted-foreground">
                      {entry.resourceType}/{entry.resourceId?.slice(0, 8) ?? "?"}
                    </span>
                  ) : null}
                  <Badge
                    variant={result.bad ? "outline" : "accent"}
                    className={result.bad ? "text-destructive" : undefined}
                  >
                    {result.label}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {entry.actorTokenId ? "jeton · " : ""}
                    {new Date(entry.createdAt).toLocaleString("fr-FR")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
