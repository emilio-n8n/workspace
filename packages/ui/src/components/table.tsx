import { forwardRef, type HTMLAttributes, type ThHTMLAttributes } from "react";
import { cn } from "../cn.ts";

export type TableProps = HTMLAttributes<HTMLTableElement>;

const alignClasses = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

export type TableAlign = keyof typeof alignClasses;

export type TableCellProps = HTMLAttributes<HTMLTableCellElement> & {
  /** Alignement du contenu (défaut : gauche). */
  align?: TableAlign;
  /** Colonne de nombres : alignement à droite et chiffres tabulaires. */
  numeric?: boolean;
};

export type TableHeadProps = ThHTMLAttributes<HTMLTableCellElement> & {
  align?: TableAlign;
};

/**
 * Tableau — conteneur à défilement horizontal autour d'un `<table>` sémantique.
 * Le style (bordures, survol) est porté par `TableRow`, `TableHead` et
 * `TableCell`, tous alignés sur les tokens de surface.
 */
export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  { className, ...props },
  ref,
) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        ref={ref}
        className={cn("w-full caption-bottom border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
});

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("[&_tr]:border-b [&_tr]:border-border", className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableFooter({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot className={cn("border-t border-border bg-muted/50 font-medium", className)} {...props} />
  );
}

/** Ligne de tableau — survol atténué, ligne sélectionnée signalée par `aria-selected`. */
export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors hover:bg-muted/50 aria-selected:bg-accent aria-selected:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Cellule d'en-tête — toujours `scope="col"` sauf demande contraire. */
export function TableHead({ className, align = "left", scope = "col", ...props }: TableHeadProps) {
  return (
    <th
      scope={scope}
      className={cn(
        "h-10 whitespace-nowrap px-3 font-medium text-muted-foreground",
        alignClasses[align],
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  align = "left",
  numeric = false,
  ...props
}: TableCellProps) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-middle text-foreground",
        alignClasses[numeric ? "right" : align],
        numeric ? "tabular-nums" : undefined,
        className,
      )}
      {...props}
    />
  );
}

/** Légende du tableau — description lue par les lecteurs d'écran, masquable visuellement. */
export function TableCaption({
  className,
  visuallyHidden = false,
  ...props
}: HTMLAttributes<HTMLTableCaptionElement> & { visuallyHidden?: boolean }) {
  return (
    <caption
      className={cn(
        visuallyHidden
          ? "absolute size-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]"
          : "mt-2 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
