import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui";
import { useState } from "react";
import type { MemberView } from "../server.ts";
import { regenerateJoinCodeFn, removeMemberFn } from "../server.ts";

/** Membre du cours, prêt à être retiré. */
export type MemberTarget = { userId: string; name: string };

/**
 * Gestion des membres d'un cours : qui est inscrit, avec quel rôle, et la
 * possibilité de retirer quelqu'un (confirmée, jamais en un clic). Le code
 * d'invitation est réaffiché ici — c'est d'ici qu'on le redonne à un élève
 * absent, sans avoir à le chercher dans l'en-tête.
 */
export function MembersDialog({
  open,
  onClose,
  courseId,
  courseName,
  members,
  /** Enseignant connecté : lui seul peut retirer un membre. */
  canManage,
  /** Enseignant propriétaire du cours : jamais retirable. */
  ownerId,
  joinCode,
  onRemoved,
  onRegenerated,
}: {
  open: boolean;
  onClose: () => void;
  courseId: string;
  courseName: string;
  members: MemberView[];
  canManage: boolean;
  ownerId: string | null;
  joinCode: string | null;
  onRemoved: () => void | Promise<void>;
  /** Appelé après régénération : le parent recharge le cours (nouveau code). */
  onRegenerated: () => void | Promise<void>;
}) {
  const [target, setTarget] = useState<MemberTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [regenerated, setRegenerated] = useState(false);

  const students = members.filter((member) => member.role === "student");

  async function confirmRemove() {
    if (!target) return;
    setBusy(true);
    try {
      await removeMemberFn({ data: { courseId, userId: target.userId } });
      setTarget(null);
      setError(null);
      await onRemoved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Retrait impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRegenerate() {
    setRegenerating(true);
    try {
      await regenerateJoinCodeFn({ data: { courseId } });
      setRegenOpen(false);
      setError(null);
      setRegenerated(true);
      await onRegenerated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Régénération impossible.");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Membres — ${courseName}`} className="max-w-2xl">
      <div className="flex flex-col gap-3">
        {canManage && joinCode ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Code d'invitation</p>
              {/* Le code est long mais rarement lu à voix haute : on le copie. */}
              <p className="font-mono text-lg tracking-widest">{joinCode}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(joinCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                Copier le code
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRegenOpen(true)}>
                Régénérer
              </Button>
            </div>
            <span role="status" aria-live="polite" className="w-full text-xs text-muted-foreground">
              {copied ? "Code copié." : ""}
              {regenerated && !copied ? "Nouveau code généré : l'ancien ne fonctionne plus." : ""}
            </span>
          </div>
        ) : null}

        {error ? <Alert tone="danger">{error}</Alert> : null}

        {members.length === 0 ? (
          <EmptyState title="Aucun membre" hint="Ce cours n'a aucun membre pour le moment." />
        ) : (
          <Table>
            <TableCaption>
              {members.length} membre{members.length > 1 ? "s" : ""} — 1 enseignant,{" "}
              {students.length} élève{students.length > 1 ? "s" : ""}.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Membre</TableHead>
                <TableHead>Rôle</TableHead>
                {canManage ? <TableHead align="right">Action</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isOwner = member.userId === ownerId;
                return (
                  <TableRow key={member.userId}>
                    <TableCell>
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">{member.name}</span>
                        <span className="text-xs text-muted-foreground">{member.email}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.role === "teacher" ? "accent" : "outline"}>
                        {member.role === "teacher" ? "Enseignant" : "Élève"}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell align="right">
                        {/* Le propriétaire ne se retire pas lui-même : un cours
                            sans enseignant n'aurait plus de gardien. */}
                        {isOwner ? (
                          <span className="text-xs text-muted-foreground">Propriétaire</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => setTarget({ userId: member.userId, name: member.name })}
                          >
                            Retirer du cours
                          </Button>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <p className="text-xs text-muted-foreground">
          Retirer un élève lui ferme l'accès au cours ; ses copies déjà rendues et leurs notes sont
          conservées.
        </p>
      </div>

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={() => void confirmRemove()}
        title="Retirer ce membre"
        message={
          <>
            Retirer {target?.name ?? "ce membre"} du cours ? Il perdra l'accès aux devoirs et aux
            publications. Ses copies déjà notées restent dans le carnet.
          </>
        }
        confirmLabel="Retirer du cours"
        busy={busy}
        destructive
      />

      <ConfirmDialog
        open={regenOpen}
        onClose={() => setRegenOpen(false)}
        onConfirm={() => {
          setRegenerated(false);
          void confirmRegenerate();
        }}
        title="Régénérer le code d'invitation"
        message={
          <>
            L'ancien code cessera immédiatement de fonctionner. Les élèves déjà inscrits gardent
            leur accès ; seul le code change. Pensez à le communiquer aux nouvelles personnes à
            inviter.
          </>
        }
        confirmLabel="Régénérer le code"
        busy={regenerating}
      />
    </Dialog>
  );
}
