# Études techniques — moteurs et intégrations

Ces études précèdent les décisions structurantes sur les composants les plus lourds de la suite (moteur de documents, tableur, présentations, messagerie, visioconférence). Elles alimentent des ADR dans `docs/decisions/`.

## Grille d'analyse commune

Chaque étude évalue les candidats selon :

1. **Licence** exacte (OSI ? compatible AGPL-3.0-only ?) et modèle commercial.
2. **Auto-hébergement** intégral, sans dépendance obligatoire à un service propriétaire.
3. **Sécurité** : historique de vulnérabilités, surface d'attaque (iframe, sidecar), mises à jour.
4. **Intégration** technique avec TanStack Start / React / TypeScript, effort réel.
5. **Formats & interopérabilité** : import/export (OOXML, ODF, formats ouverts), fidélité.
6. **Collaboration** et temps réel (si pertinent).
7. **Personnalisation UI** : possibilité de conserver une interface cohérente avec la suite (skin, i18n, accessibilité).
8. **Performance** sur machines modestes (poids client, mémoire serveur).
9. **Risques** : bus factor, gouvernance, télémétrie, dettes.
10. **Plan d'intégration progressif** et critères de POC.

## Études

| Étude | Fichier | Statut | ADR attendu |
|---|---|---|---|
| S1 — Moteur de documents (Docs) | [`docs-engine.md`](docs-engine.md) | ✅ livrée — Tiptap 3 + Yjs/Hocuspocus recommandés | ADR moteur Docs |
| S2 — Moteur de tableur (Sheets) | [`sheets-engine.md`](sheets-engine.md) | ✅ livrée — Univer OSS + pont xlsx maison ; FortuneSheet en repli | ADR moteur Sheets |
| S3 — Moteur de présentations (Slides) | [`slides-engine.md`](slides-engine.md) | ✅ livrée — éditeur maison (react-konva) + pptxgenjs/pptxtojson ; sidecar optionnel | ADR moteur Slides |
| S4 — Socle messagerie (Mail) | [`mail-stack.md`](mail-stack.md) | ✅ livrée — Stalwart en sidecar + UI maison JMAP | ADR socle Mail |
| S5 — Moteur de visioconférence (Meet) | [`meet-engine.md`](meet-engine.md) | ✅ livrée — LiveKit + coturn, UI maison | ADR moteur Meet |

## Règle de décision

Une étude ne décide pas seule : la recommandation est transformée en ADR par le lead, en tenant compte de la licence du projet (AGPL-3.0-only), de l'effort d'intégration et de la cohérence d'ensemble. En cas de doute persistant, un POC minimal est planifié avant décision définitive.
