import { cn } from "@shogi/design-system";
import type { ComponentPropsWithRef, ReactElement } from "react";

/** ダイアログの右上に置く「×」のボタン。`DialogClose asChild` の中にも置ける。 */
export function CloseIconButton({
    className,
    "aria-label": ariaLabel = "閉じる",
    ...props
}: ComponentPropsWithRef<"button">): ReactElement {
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            className={cn(
                "p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors",
                className,
            )}
            {...props}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
        </button>
    );
}
