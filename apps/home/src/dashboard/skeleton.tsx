import { cn } from "@workspace/ui";
import type { ReactNode } from "react";

/**
 * Squelettes de chargement.
 *
 * Aucun spinner sur les surfaces de liste : un bloc gris à la bonne hauteur
 * dit « quelque chose arrive ici » sans faire danser la mise en page. Chaque
 * squelette reprend la hauteur de son contenu final, et le conteneur porte
 * `aria-busy` pendant l'attente.
 */

/** Bloc de squelette — hauteur et largeur fournies par l'appelant. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

/** Groupe de squelettes : annonce l'attente et masque les blocs décoratifs. */
export function SkeletonGroup({
  label,
  className,
  children,
}: {
  /** Annonce lue par les lecteurs d'écran (« Recherche en cours… »). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div aria-busy="true" className={className}>
      {children}
      <p role="status" className="sr-only">
        {label}
      </p>
    </div>
  );
}

/** Tuile de raccourci ou d'application (mêmes gabarits que les cartes réelles). */
export function SkeletonCard({ className }: { className?: string }) {
  return <Skeleton className={cn("h-28 rounded-xl", className)} />;
}

/** Ligne de liste (fichier récent, résultat de recherche). */
export function SkeletonRow({ className }: { className?: string }) {
  return <Skeleton className={cn("h-11", className)} />;
}
