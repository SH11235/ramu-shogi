import { cn } from "@shogi/design-system";
import type { InputHTMLAttributes, ReactElement } from "react";
import { forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
    { className, type = "text", ...props },
    ref,
): ReactElement {
    return (
        <input
            className={cn(
                "flex h-10 w-full rounded-2xl border border-wafuu-border bg-card/70 px-3.5 py-2 text-sm shadow-[inset_0_1px_3px_hsl(var(--ram-shadow)/0.08)] ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                className,
            )}
            ref={ref}
            type={type}
            {...props}
        />
    );
});
