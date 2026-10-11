import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../cn.ts";

const badgeVariants = cva("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-muted text-muted-foreground",
      accent: "bg-accent text-accent-foreground",
      outline: "border border-border text-foreground",
      destructive: "border border-destructive/40 bg-destructive/10 text-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
