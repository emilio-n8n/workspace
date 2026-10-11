# Module Sites

## Objectif
Des sites internes simples pour l'équipe : pages en Markdown, rendu HTML sûr,
stockage dans le Drive.

## Périmètre (livré)
- Site = fichier Drive lié ; pages ordonnées (celle d'accueil créée d'office),
  slugs stables et uniques par site.
- Éditeur : titre de page, contenu Markdown, aperçu ; au moins une page
  conservée.
- Rendu Markdown **sûr** : échappement du HTML d'abord, puis transformations
  contrôlées (titres, listes, gras/italique, code, citations, liens http(s)
  uniquement) — moteur pur et testé.
- MCP : `sites.read` (pages + contenu d'une page).

## Autorisations
Droits Drive ; rendu sans HTML brut possible (l'échappement précède le rendu) ;
aucun script exécutable.

## Critères d'acceptation
Créer un site, ajouter/renommer des pages, aperçu correct, refus des liens
javascript:, refus de suppression de la dernière page (tests unitaires du
rendu + service + E2E).

## Hors périmètre
Publication externe, thèmes, images, navigation imbriquée.
