# Module Admin

## Objectif
Administrer l'organisation : profil, membres et rôles, quota de stockage,
journal d'audit.

## Périmètre (livré)
- Synthèse : nom/slug, nombre de membres, fichiers et octets utilisés, quota,
  nombre d'événements d'audit.
- Membres : liste (nom, e-mail, rôle), ajout d'un **compte existant** par
  e-mail, changement de rôle (administrateur/membre), retrait ; le
  propriétaire est intouchable et l'on ne modifie pas son propre rôle.
- Quota de stockage : valeur en Go ou illimité (upsert `org_settings`).
- Journal d'audit : 100 derniers événements de l'organisation (action,
  résultat, ressource, jeton éventuel).

## Autorisations
Strictement réservé aux rôles `owner` et `admin` (vérifié côté serveur ;
l'écran n'est qu'une vue). Isolé par organisation.

## Critères d'acceptation
Refus pour un membre simple, ajout d'un compte existant une seule fois,
protection du propriétaire, quota persistant, audit filtré par organisation
(tests de service + E2E).

## Hors périmètre
Invitations par e-mail (nécessite SMTP), rétention, SSO d'entreprise,
élévation de privilèges par décret.
