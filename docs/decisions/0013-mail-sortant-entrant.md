# ADR-0013 — Mail : SMTP sortant + ingestion webhook entrante

**Statut** : accepté
**Date** : 2026-10-11

## Contexte

Un client IMAP complet (synchronisation bidirectionnelle, drapeaux, dossiers
distants, rendez-vous) est un chantier de plusieurs semaines et une source
classique de corruption de boîtes. À l'inverse, un serveur de messagerie
(Postfix, docker-mailserver) est déjà une brique que beaucoup d'exploitants
auto-hébergés font tourner. Le besoin fonctionnel v1 est : écrire, envoyer,
recevoir et ranger.

## Décision

- **Sortant** : SMTP de l'instance (`SMTP_HOST`, …). Le message est **toujours**
  conservé dans « Envoyés » ; en cas d'échec (ou sans SMTP), l'erreur est
  attachée au message — jamais d'échec silencieux ni de perte.
- **Entrant** : l'exploitant garde son MX (Postfix, docker-mailserver,
  fournisseur) et le fait pousser vers `POST /api/mail/inbound` avec
  `x-mail-secret: $MAIL_WEBHOOK_SECRET`. Le service relie l'adresse à la boîte
  locale, refuse un secret invalide et journalise.
- **Pas d'IMAP client en v1** — décision révisable une fois les flux réels
  observés.

## Conséquences

- Positif : robuste, testable, pas de synchronisation à corruption ; le
  serveur de messagerie reste chez l'exploitant (un seul MTA à administrer).
- Négatif : les dossiers distants du fournisseur ne sont pas reflétés ; les
  pièces jointes arriveront avec le téléversement Drive dans une itération
  suivante (documenté hors périmètre).
