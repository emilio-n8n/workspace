# ADR-0010 — Socle messagerie (Mail)

**Statut** : accepté sous réserve du POC de délivrabilité
**Date** : 2026-10-10
**Source** : [`docs/studies/mail-stack.md`](../studies/mail-stack.md)

## Contexte

Une interface de messagerie ne suffit pas : il faut SMTP/IMAP/JMAP, délivrabilité (SPF/DKIM/DMARC, réputation d'IP, port 25), antispam et exploitation. Reconstruire un serveur de messagerie serait une erreur stratégique ; l'étude tranche pour l'intégration d'un composant éprouvé, avec une UI qui reste la nôtre.

## Décision

- **Workspace ne développe pas de MTA/MDA.** Sidecar recommandé : **Stalwart** (AGPL-3.0-only, Rust, JMAP/IMAP/SMTP natifs).
- **UI maison JMAP-first** dans Workspace (lecture, écriture, recherche, étiquettes) ; **IMAP en repli** pour les comptes existants ; CalDAV/CardDAV en pont avec Calendar tant que JMAP Calendars est un brouillon.
- **Options documentées** pour l'exploitant : docker-mailserver (minimal, MIT), Mailu, mailcow — et clients web tiers (Roundcube, SOGo) comme **repli**, jamais par défaut (cohérence de suite).
- **Exigences opérationnelles assumées et documentées** : DNS (SPF/DKIM/DMARC — RFC 9989/9990/9991), PTR, port 25 souvent bloqué chez les hébergeurs (relais sortant à prévoir), Rspamd.
- **POC de délivrabilité réelle** = critère de sortie obligatoire avant toute promesse d'usage en production.
- Attention licence : les fonctions multi-tenant/dashboards de Stalwart sont **Enterprise** (payantes) — la cible d'hébergement multi-organisations devra être validée au POC.

## Conséquences

- Positif : robustesse d'un serveur éprouvé + expérience unifiée côté Workspace ; périmètre réalisable en Phase 4.
- Négatif : dépendance d'exploitation à un sidecar ; délivrabilité = sujet d'infrastructure (réputation, DNS) hors du contrôle du logiciel seul ; honnêteté requise dans la documentation (« complet » seulement quand les contraintes réseau/DNS sont traitées).
- Obligation : POC en environnement réel (envoi/réception externes, DMARC, blocklists) avant d'annoncer le module comme utilisable.

## Alternatives étudiées

| Option | Pourquoi écartée (à ce stade) |
|---|---|
| Reconstruire un serveur mail | Effort, sécurité et exploitation hors de portée du projet — explicitement écarté par le brief |
| mailcow | Suite lourde (≥ 6 Go RAM), opérée comme un produit à part |
| docker-mailserver | Minimal, pas de JMAP/DAV/UI — bon repli, moins bon socle produit |
| Mailu | Ligne majeure figée depuis 2024, incident CVE récent |
| Roundcube / SOGo par défaut | Incohérence d'interface ; conservés comme repli documenté |
