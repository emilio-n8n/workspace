# ADR-0007 — Moteur de documents (Docs)

**Statut** : accepté sous réserve des POC listés
**Date** : 2026-10-10
**Source** : [`docs/studies/docs-engine.md`](../studies/docs-engine.md)

## Contexte

Le module Docs doit offrir une édition riche (titres, listes, tableaux, images, liens), l'autosave, les versions, l'export/import (Markdown, HTML, DOCX), avec une fidélité OOXML **mesurée et honnête**, une UI qui reste la nôtre, et des licences compatibles AGPL-3.0-only.

## Décision

- **Éditeur** : **Tiptap 3** (ProseMirror, MIT) embarqué dans notre UI React.
- **Collaboration temps réel (Phase 3)** : **Yjs + Hocuspocus** (MIT).
- **Conversions** : import DOCX via **mammoth** (durci : taille, entités, sandbox) ; export DOCX via **docx** ; conversions avancées via **Pandoc** en sidecar processus séparé (GPL — jamais lié) ; PDF via **LibreOffice headless**.
- Les **sidecars Collabora Online / ONLYOFFICE Docs** ne sont pas le cœur : conservés comme option « compatibilité haute fidélité » ultérieure, jamais comme chemin principal.

## Conséquences

- Positif : contrôle total de l'UI et des interactions ; chaîne de licences MIT/AGPL claire ; chemin MVP réaliste ; pas d'iframe opaque.
- Négatif : la fidélité DOCX sera **partielle** et doit être communiquée ; un corpus de tests de conversion est requis (S1 §6) ; le rendu DOCX complexe (pagination, objets) n'est pas promis.
- Obligation : POC avant développement module — fidélité MD/HTML/DOCX sur corpus, charge Hocuspocus sur 4 cœurs, durcissement de l'import.

## Alternatives étudiées

| Option | Pourquoi écartée (à ce stade) |
|---|---|
| Lexical | Viable, mais écosystème d'extensions et outillage conversion moins directs pour notre périmètre |
| ProseMirror direct | Trop bas niveau : coût d'assemblage sans bénéfice produit |
| Plate | Surcouche Tiptap — dépendance supplémentaire sans gain décisif |
| Collabora / ONLYOFFICE comme cœur | Poids d'exploitation, UI non maîtrisée (cohérence de suite), surfaces CVE historiques |
| Liveblocks (collaboration) | Service propriétaire — contraire à l'auto-hébergement |
