# Module Mail

## Objectif
Une boîte locale par utilisateur, l'envoi via le SMTP de l'instance et
l'ingestion du courrier entrant par webhook (le serveur de messagerie de
l'exploitant fait MX et pousse vers Workspace).

## Périmètre (livré)
- Boîtes locales (`adresse@MAIL_DOMAIN`, dérivée du compte) : un utilisateur,
  une boîte par organisation.
- Dossiers : Boîte de réception, Envoyés, Brouillons, Corbeille (restauration
  avec dossier d'origine, suppression définitive uniquement depuis la corbeille).
- Lecture (marquage automatique au premier affichage), suivi ★, recherche
  (objet, expéditeur, corps), compteurs de non-lus.
- Envoi : conservé dans « Envoyés » **dans tous les cas** ; transmission SMTP
  si configurée ; toute erreur est attachée au message (jamais silencieuse).
- Ingestion entrante : `POST /api/mail/inbound` avec `x-mail-secret`
  (`MAIL_WEBHOOK_SECRET`) ; boîte inconnue → 404.
- MCP : `mail.list`, `mail.send`.

## Décision
Sortant SMTP + entrant webhook, pas d'IMAP client en v1 (ADR-0013) : robuste,
testable et conforme au modèle « MX chez l'exploitant ».

## Critères d'acceptation
Brouillon modifiable puis envoyé, message conservé avec erreur explicite sans
SMTP, corbeille/restauration/suppression, secret d'ingestion exigé (tests de
service + E2E).

## Hors périmètre
Fils de discussion, pièces jointes, IMAP direct, PGP.
