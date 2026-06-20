import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";

type StatusBannerVariant = "error" | "success";

const variantClass: Record<StatusBannerVariant, string> = {
    success: "border-status-success-border bg-status-success-bg text-status-success",
    error: "border-destructive/30 bg-destructive/10 text-destructive",
};

interface StatusBannerProps {
    variant: StatusBannerVariant;
    className?: string;
    children: ReactNode;
}

/** 成功 / エラーの帯。色は design system の status-success / destructive トークンで揃える。 */
export function StatusBanner({ variant, className, children }: StatusBannerProps): ReactElement {
    return (
        <div
            role={variant === "error" ? "alert" : "status"}
            className={cn("rounded-xl border px-4 py-3 text-sm", variantClass[variant], className)}
        >
            {children}
        </div>
    );
}
