import { Badge, Button, Dialog } from "@workspace/ui";
import { useEffect, useState } from "react";
import {
  addChannelMemberFn,
  type ChannelMemberView,
  listOrgMembersFn,
  type OrgMemberView,
} from "../server.ts";

export type MembersDialogProps = {
  open: boolean;
  onClose: () => void;
  channelId: string | null;
  channelName: string;
  /** Vrai pour un canal privé : lui et ses membres sont invisibles ailleurs. */
  privateChannel: boolean;
  /** Vrai si l'acteur peut inviter (créateur du canal, canal non archivé). */
  canInvite: boolean;
  /** Membres de la conversation, fournis par la vue (source unique). */
  members: readonly ChannelMemberView[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Appelé après une invitation : la liste et la barre latérale se rafraîchissent. */
  onInvited: () => void;
};

/**
 * Membres d'une conversation — la liste est visible par les membres, y compris
 * pour un canal privé : c'est ce qui rend la confidentialité lisible (« je vois
 * exactement avec qui je parle »). Le créateur peut inviter directement un
 * membre de l'organisation, seul moyen d'entrer dans un canal privé.
 */
export function MembersDialog({
  open,
  onClose,
  channelId,
  channelName,
  privateChannel,
  canInvite,
  members,
  loading,
  error,
  onRetry,
  onInvited,
}: MembersDialogProps) {
  const [orgMembers, setOrgMembers] = useState<OrgMemberView[]>([]);
  const [invitee, setInvitee] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // L'annuaire de l'organisation n'est utile qu'au formulaire d'invitation : il
  // n'est chargé que si le panneau est ouvert par une personne qui peut inviter.
  useEffect(() => {
    if (!open || !canInvite) return;
    let cancelled = false;
    void listOrgMembersFn()
      .then((rows) => {
        if (!cancelled) setOrgMembers(rows);
      })
      .catch(() => {
        // Formulaire masqué : pas de bruit pour l'utilisateur.
        if (!cancelled) setOrgMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, canInvite]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: remise à zéro à chaque ouverture ou changement de canal.
  useEffect(() => {
    setInvitee("");
    setInviteError(null);
  }, [open, channelId]);

  async function onInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!channelId || invitee.length === 0) return;
    setInviting(true);
    setInviteError(null);
    try {
      await addChannelMemberFn({ data: { channelId, userId: invitee } });
      setInvitee("");
      onInvited();
    } catch (caught) {
      setInviteError(caught instanceof Error ? caught.message : "Invitation impossible.");
    } finally {
      setInviting(false);
    }
  }

  const invitable = orgMembers.filter((member) => !members.some((row) => row.id === member.id));

  return (
    <Dialog open={open} onClose={onClose} title={`Membres — ${channelName}`}>
      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement des membres…</p>
      ) : error ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <div>
            <Button type="button" variant="ghost" onClick={onRetry}>
              Réessayer
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {privateChannel ? (
            <p className="text-xs text-muted-foreground">
              Canal privé : lui et ses membres sont invisibles pour le reste de l'organisation.
            </p>
          ) : null}
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun membre pour le moment.</p>
          ) : (
            <ul
              aria-label="Membres du canal"
              className="flex max-h-60 flex-col gap-1 overflow-y-auto"
            >
              {members.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="truncate font-medium">{member.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                  {member.creator ? (
                    <Badge variant="outline" className="ml-auto shrink-0">
                      Créateur
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canInvite && invitable.length > 0 ? (
            <form
              className="flex items-end gap-2 border-t border-border pt-3"
              onSubmit={(event) => void onInvite(event)}
            >
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-muted-foreground" htmlFor="invite-member">
                  Inviter un membre de l'organisation
                </label>
                <select
                  id="invite-member"
                  value={invitee}
                  onChange={(event) => setInvitee(event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Choisir une personne…</option>
                  {invitable.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} — {member.email}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm" loading={inviting} disabled={invitee.length === 0}>
                Inviter
              </Button>
            </form>
          ) : null}

          {inviteError ? (
            <p role="alert" className="text-sm text-destructive">
              {inviteError}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
