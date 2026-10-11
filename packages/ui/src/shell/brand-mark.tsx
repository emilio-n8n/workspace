import { cn } from "../cn.ts";

/** Marque Workspace — « W » en Bricolage Grotesque sur aplat primary. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 place-items-center rounded-lg bg-primary font-display text-lg font-bold text-primary-foreground shadow-soft",
        className,
      )}
    >
      W
    </span>
  );
}
