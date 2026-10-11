/**
 * Compatibilité : la construction de l'acteur serveur vit dans @workspace/auth
 * (partagée par toutes les applications de la suite). Ce module sera supprimé
 * avec l'application monolithique.
 */
export { requireActor } from "@workspace/auth";
