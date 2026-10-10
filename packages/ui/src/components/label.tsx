import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "../cn.ts";

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, ...props },
  ref,
) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: label réutilisable, le htmlFor est fourni par l'appelant.
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
});
