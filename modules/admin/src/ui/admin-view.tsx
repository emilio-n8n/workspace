import { Alert, Badge, Button, ConfirmDialog, Dialog, Input, Label } from "@workspace/ui";
import { useCallback, useEffect, useState } from "react";
import {
  type ActiveSession,
  addMemberFn,
  eraseUserAccountFn,
  exportUserDataFn,
  getOverviewFn,
  getPoliciesFn,
  listActiveSessionsFn,
  listMembersFn,
  type MemberFull,
  type OrgOverview,
  type OrgPolicies,
  removeMemberFn,
  revokeSessionFn,
  updateMemberRoleFn,
  updateOrgProfileFn,
  updatePoliciesFn,
  updateQuotaFn,
} from "../server.ts";
import { AuditLog } from "./audit-log.tsx";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

/** « il y a X » compact pour la colonne d'activité des sessions. */
function formatRelative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "à l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

function truncateAgent(userAgent: string | null): { short: string; full: string } {
  const full = userAgent ?? "Agent inconnu";
  return { short: full.length > 60 ? `${full.slice(0, 57)}…` : full, full };
}

/** Mot à recopier pour confirmer l'effacement d'un compte (côté service aussi). */
const ERASE_CONFIRMATION = "EFFACER";

/** Déclenche le téléchargement d'un bundle JSON côté navigateur. */
function downloadJsonFile(file: { filename: string; json: string }): void {
  const url = URL.createObjectURL(new Blob([file.json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

type EraseAccountDialogProps = {
  target: MemberFull | null;
  confirmText: string;
  busy: boolean;
  onConfirmTextChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

/**
 * Confirmation destructive exigeant de recopier « EFFACER ». `ConfirmDialog`
 * ne permet ni champ de saisie ni désactivation conditionnelle de sa
 * confirmation : ce dialogue reprend la même mise en page (annuler / action
 * rouge) avec la porte de saisie.
 */
function EraseAccountDialog({
  target,
  confirmText,
  busy,
  onConfirmTextChange,
  onClose,
  onConfirm,
}: EraseAccountDialogProps) {
  const ready = confirmText === ERASE_CONFIRMATION;
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target ? `Effacer le compte de ${target.name} ?` : "Effacer ce compte ?"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            variant="outline"
            className="text-destructive"
            onClick={onConfirm}
            disabled={!ready || busy}
            loading={busy}
          >
            Effacer le compte
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-muted-foreground">
        <p>
          Le compte est pseudonymisé : nom et adresse sont remplacés, sessions et jetons d'API sont
          supprimés. Les contenus (fichiers, documents, tâches, copies) restent la propriété de
          l'organisation.
        </p>
        <div className="flex flex-col gap-1">
          <Label htmlFor="erase-confirm">{`Tapez ${ERASE_CONFIRMATION} pour confirmer`}</Label>
          <Input
            id="erase-confirm"
            value={confirmText}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => onConfirmTextChange(event.target.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Administration de l'organisation : profil, membres et rôles, sessions
 * actives, quota de stockage et journal d'audit. Réservé aux rôles owner/admin
 * (vérifié côté serveur — cet écran n'est qu'une vue).
 */
export function AdminView() {
  const [overview, setOverview] = useState<OrgOverview | null>(null);
  const [members, setMembers] = useState<MemberFull[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [revokeTarget, setRevokeTarget] = useState<ActiveSession | null>(null);
  const [eraseTarget, setEraseTarget] = useState<MemberFull | null>(null);
  const [eraseConfirm, setEraseConfirm] = useState("");
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const [orgName, setOrgName] = useState("");
  const [quotaGo, setQuotaGo] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [policies, setPolicies] = useState<OrgPolicies | null>(null);
  const [sharingDraft, setSharingDraft] = useState(true);
  const [retentionDraft, setRetentionDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [data, memberList, sessionList, policyData] = await Promise.all([
        getOverviewFn(),
        listMembersFn(),
        listActiveSessionsFn(),
        getPoliciesFn(),
      ]);
      setOverview(data);
      setOrgName(data.org.name);
      setQuotaGo(data.quotaBytes ? String(Math.round(data.quotaBytes / 1024 ** 3)) : "");
      setMembers(memberList);
      setSessions(sessionList);
      setPolicies(policyData);
      setSharingDraft(policyData.allowExternalSharing);
      setRetentionDraft(String(policyData.versionRetentionDays));
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
      setAuditRefreshKey((key) => key + 1);
      flash(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    const target = revokeTarget;
    await guard(() => revokeSessionFn({ data: { sessionId: target.id } }), "Session révoquée.");
    setRevokeTarget(null);
  }

  /** Export RGPD : le serveur construit le bundle, le navigateur le télécharge. */
  async function onExport(entry: MemberFull) {
    await guard(async () => {
      downloadJsonFile(await exportUserDataFn({ data: { userId: entry.userId } }));
    }, "Export téléchargé.");
  }

  async function confirmErase() {
    if (!eraseTarget) return;
    const target = eraseTarget;
    await guard(
      () => eraseUserAccountFn({ data: { userId: target.userId, confirm: eraseConfirm } }),
      "Compte effacé.",
    );
    setEraseTarget(null);
    setEraseConfirm("");
  }

  const retentionValue = Number(retentionDraft);
  const retentionValid =
    Number.isInteger(retentionValue) && retentionValue >= 7 && retentionValue <= 3650;

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

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

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
              {entry.role !== "owner" && entry.userId !== overview?.actorUserId ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Exporter les données de ${entry.name}`}
                    disabled={busy}
                    onClick={() => void onExport(entry)}
                  >
                    Exporter
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={`Effacer le compte de ${entry.name}`}
                    disabled={busy}
                    onClick={() => {
                      setEraseConfirm("");
                      setEraseTarget(entry);
                    }}
                  >
                    Effacer
                  </Button>
                </>
              ) : null}
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
        <h2 className="font-display text-sm font-semibold">Politiques</h2>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              id="allow-external-sharing"
              type="checkbox"
              aria-label="Autoriser le partage externe"
              className="size-4 accent-primary"
              checked={sharingDraft}
              disabled={busy || policies === null}
              onChange={(event) => setSharingDraft(event.target.checked)}
            />
            <Label htmlFor="allow-external-sharing">Autoriser le partage externe</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Hors de votre organisation — les liens et partages externes sont refusés quand
            désactivé.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex w-48 flex-col gap-1">
            <Label htmlFor="version-retention">Rétention des versions (jours)</Label>
            <Input
              id="version-retention"
              type="number"
              min={7}
              max={3650}
              value={retentionDraft}
              disabled={busy || policies === null}
              onChange={(event) => setRetentionDraft(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Les versions des documents et fichiers plus anciennes sont nettoyées automatiquement.
          </p>
        </div>
        <div>
          <Button
            size="sm"
            loading={busy}
            disabled={policies === null || !retentionValid}
            onClick={() =>
              void guard(
                () =>
                  updatePoliciesFn({
                    data: {
                      allowExternalSharing: sharingDraft,
                      versionRetentionDays: retentionValue,
                    },
                  }),
                "Politiques mises à jour.",
              )
            }
          >
            Enregistrer
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h2 className="font-display text-sm font-semibold">Sessions actives</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune session active.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {sessions.map((entry) => {
              const agent = truncateAgent(entry.userAgent);
              return (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{entry.userName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.userEmail}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-col text-xs text-muted-foreground">
                    <span>{entry.ipAddress ?? "IP inconnue"}</span>
                    <span className="max-w-64 truncate" title={agent.full}>
                      {agent.short}
                    </span>
                  </span>
                  <span className="flex flex-col text-right text-xs text-muted-foreground">
                    <span>{formatRelative(entry.createdAt)}</span>
                    <span>expire le {new Date(entry.expiresAt).toLocaleString("fr-FR")}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => setRevokeTarget(entry)}
                  >
                    Révoquer
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
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

      <AuditLog refreshKey={auditRefreshKey} />

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => void confirmRevoke()}
        title="Révoquer cette session ?"
        message="L'appareil concerné devra se reconnecter."
        confirmLabel="Révoquer"
        busy={busy}
        destructive
      />

      <EraseAccountDialog
        target={eraseTarget}
        confirmText={eraseConfirm}
        busy={busy}
        onConfirmTextChange={setEraseConfirm}
        onClose={() => {
          setEraseTarget(null);
          setEraseConfirm("");
        }}
        onConfirm={() => void confirmErase()}
      />
    </div>
  );
}
