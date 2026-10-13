# Glossaire

Lexique français unique des termes produit de Workspace. **Toutes les escouades (interface, documentation, code, textes produit) emploient exclusivement ces termes** pour désigner ces concepts. L'anglicisme n'est toléré que comme nom propre technique (`SSO`, `MCP`, `scope`, `webhook`).

En cas de doute sur un mot, ce fichier fait référence. Un terme nouveau passe par ici avant d'entrer dans l'interface.

## Termes

| Terme | Définition |
| --- | --- |
| **Application** | Chacun des 14 modules livrés comme application autonome de la suite (Accueil, Drive, Docs, Tasks, Calendar, Forms, Sheets, Slides, Mail, Chat, Meet, Sites, Classroom, Admin). Ports de développement 3000 à 3013. |
| **Audit** (journal d'audit) | Enregistrement des actions sensibles — mutations web et appels MCP (succès, refus, erreurs) — consultable dans l'application Admin par les rôles habilités. |
| **Canal** | Espace de conversation nommé dans Chat, ouvert aux membres d'une organisation ; à distinguer de la discussion directe entre deux personnes. |
| **Confirmation littérale** | Exigence de sécurité des outils MCP destructeurs : l'agent doit repasser la valeur exacte demandée (`confirm: "SUPPRIMER"`), ce qui empêche toute suppression accidentelle. |
| **Corbeille** | État intermédiaire d'un fichier supprimé : l'élément reste restaurable jusqu'à la purge définitive, réservée au propriétaire. |
| **Devoir** | Travail assigné par un enseignant dans Classroom, avec énoncé, échéance et pièces jointes éventuelles. |
| **Dossier** | Conteneur de fichiers dans le Drive ; l'arborescence est propre à une organisation. |
| **Espace de travail** | Environnement complet auquel donne accès une connexion : l'instance Workspace de l'utilisateur, avec ses applications, ses données et ses réglages. Terme unique pour « workspace » dans les textes. |
| **Équipe** | Regroupement de membres au sein d'une organisation, utilisable comme bénéficiaire d'un partage. À ne pas confondre avec l'organisation. |
| **Fichier** | Unité de stockage du Drive (binaire ou texte), rangée dans un dossier, partageable et versionnable lorsqu'il s'agit d'un document. |
| **Invitation** | Message invitant une adresse e-mail à rejoindre une organisation avec un rôle donné ; expire si elle n'est pas acceptée. |
| **Jeton** (jeton d'API) | Secret porté par un agent IA pour appeler le serveur MCP : scopes minimaux, expiration à 90 jours par défaut, révocation immédiate. Le jeton en clair n'est montré qu'à la création. |
| **Jeton de collaboration** | Secret de courte durée (2 h) signé par l'application pour autoriser une session d'édition temps réel (serveur Yjs) sur un document. |
| **Lien de partage** | URL révocable donnant un accès borné à un fichier sans compte ; le jeton du lien est stocké sous forme d'empreinte. |
| **Membre** | Utilisateur rattaché à une organisation. Un même utilisateur peut être membre de plusieurs organisations. |
| **Message** | Publication échangée dans un canal ou une discussion directe de Chat ; peut porter des pièces jointes. |
| **Migration** | Script SQL versionné qui fait évoluer le schéma de la base ; appliqué par `pnpm db:migrate` (cœur puis modules, chacun avec son propre registre). |
| **Notification** | Signal émis par la suite (mention, partage, devoir, échéance…) et diffusé en temps réel à l'utilisateur concerné. |
| **Organisation** | Locataire métier de la suite : comptes, fichiers et permissions sont isolés par organisation. Terme unique pour le multi-locataire (« tenant »). |
| **Partage** | Autorisation explicite d'accès à une ressource (fichier, document, agenda, canal, liste de tâches…) en faveur d'un utilisateur, d'une équipe ou de l'organisation. Refus par défaut : rien n'est accessible sans partage ou appartenance. |
| **Rendu** | Copie déposée par un élève en réponse à un devoir, avec ses pièces jointes ; noté par l'enseignant. |
| **Rôle** (d'organisation) | Niveau d'un membre dans l'organisation — `owner`, `admin` ou `member` ; conditionne l'accès aux fonctions d'administration. |
| **Rôle** (de partage) | Niveau d'accès accordé par un partage — `viewer` (lecture), `commenter` (lecture et commentaires), `editor` (modification), `owner` (contrôle complet). |
| **Scope** | Permission élémentaire d'un jeton d'API, au format `module:action` (ex. `drive:read`, `docs:write`) ; un outil MCP n'est utilisable qu'avec les scopes qu'il exige. |
| **Session** | Connexion authentifiée matérialisée par un cookie de session ; révocable, et partagée entre les applications en production (voir SSO). |
| **SSO** | Connexion unique : une authentification sur l'Accueil ouvre les 14 applications sans reconnexion, via un cookie de session porté par le domaine. |
| **Version** | Instantané numéroté du contenu d'un document ; l'historique est consultable et le retour à une version ancienne crée une nouvelle version. |

## Règles d'usage

- **Un concept, un terme.** Ne pas alterner entre « espace de travail » et « instance », entre « organisation » et « équipe », entre « jeton » et « clé ».
- **Français par défaut** dans l'interface, la documentation et les textes produit ; l'anglais reste réservé aux noms propres (`SSO`, `MCP`, `scope`, `webhook`).
- **Cohérence code/interface** : les valeurs du schéma ci-dessus (`owner`, `admin`, `member` ; `viewer`, `commenter`, `editor`, `owner`) sont affichées dans l'interface avec les libellés de ce glossaire.
- Toute nouvelle notion produit (module, fonctionnalité transverse) ajoute sa ligne ici **avant** son arrivée dans l'interface.
