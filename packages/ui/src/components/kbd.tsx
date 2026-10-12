import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export type KbdProps = {
  children: ReactNode;
  className?: string;
};

/** Touche clavier — représentation inline d'un raccourci (ex. ⌘ K). */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
