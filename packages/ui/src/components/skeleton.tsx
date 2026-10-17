import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../cn.ts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.tsx";

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Squelette — bloc de chargement purement visuel (`aria-hidden` : l'état est
 * porté par la zone, voir `LoadingRegion`). Tokens uniquement, coins arrondis,
 * pulsation lente. Sous `prefers-reduced-motion`, la pulsation est ralentie par
 * `reduced-motion.css` et non supprimée : elle signale une activité en cours.
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />
  );
}

export type SkeletonTextProps = {
  /** Nombre de lignes (défaut : 3). */
  lines?: number;
  /** Largeur de la dernière ligne, plus courte (défaut : 60 %). */
  lastLineWidth?: string;
  className?: string;
};

/**
 * Lignes de texte factices — hauteur de ligne estimée à 12 px (équivalent
 * `text-sm`), dernière ligne volontairement plus courte pour un rendu naturel.
 */
export function SkeletonText({ lines = 3, lastLineWidth = "60%", className }: SkeletonTextProps) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: lignes factices statiques, jamais réordonnées
          key={index}
          className="h-3 w-full"
          style={index === lines - 1 ? { width: lastLineWidth } : undefined}
        />
      ))}
    </div>
  );
}

export type SkeletonCircleProps = {
  /** Diamètre en pixels (défaut : 40). */
  size?: number;
  className?: string;
};

/** Avatar factice — cercle de diamètre `size`. */
export function SkeletonCircle({ size = 40, className }: SkeletonCircleProps) {
  return (
    <Skeleton
      aria-hidden
      className={cn("shrink-0 rounded-full", className)}
      style={{ width: size, height: size }}
    />
  );
}

export type SkeletonCardProps = {
  /** Nombre de lignes de texte sous le titre (défaut : 3). */
  lines?: number;
  className?: string;
};

/** Carte factice — reprend la surface des cartes réelles (bordure, fond, ombre). */
export function SkeletonCard({ lines = 3, className }: SkeletonCardProps) {
  return (
    <div
      aria-hidden
      className={cn("rounded-lg border border-border bg-card p-4 shadow-soft", className)}
    >
      <Skeleton className="h-4 w-1/3" />
      <SkeletonText lines={lines} className="mt-3" />
    </div>
  );
}

export type SkeletonTableProps = {
  /** Nombre de lignes de corps (défaut : 5). */
  rows?: number;
  /** Nombre de colonnes (défaut : 4). */
  columns?: number;
  className?: string;
};

/**
 * Tableau factice — réutilise les primitifs `Table` réelles afin que la mise en
 * page ne saute pas au moment où les données arrivent. À placer dans une
 * `LoadingRegion`.
 */
export function SkeletonTable({ rows = 5, columns = 4, className }: SkeletonTableProps) {
  return (
    <Table aria-busy="true" className={className}>
      <TableHeader>
        <TableRow>
          {Array.from({ length: columns }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: colonnes factices statiques, jamais réordonnées
            <TableHead key={index}>
              <Skeleton className="h-3 w-24" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }, (_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lignes factices statiques, jamais réordonnées
          <TableRow key={row}>
            {Array.from({ length: columns }, (_, column) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cellules factices statiques, jamais réordonnées
              <TableCell key={column}>
                <Skeleton className={column === 0 ? "h-3 w-40" : "h-3 w-20"} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export type LoadingRegionProps = {
  children: ReactNode;
  /** Libellé annoncé aux lecteurs d'écran (défaut : « Chargement… »). */
  label?: string;
  className?: string;
};

/**
 * Zone de chargement — seule porteuse de l'état accessible : `role="status"` +
 * `aria-busy="true"` et un libellé en lecture seule d'écran, les squelettes
 * qu'elle contient restant invisibles pour les technologies d'assistance.
 */
export function LoadingRegion({ children, label = "Chargement…", className }: LoadingRegionProps) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
