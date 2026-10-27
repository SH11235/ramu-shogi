import { cn } from "@shogi/design-system";
import type { ComponentPropsWithRef, ReactElement } from "react";

/** 閉じるの「×」の印。文字の「✕」はフォントで太さと位置が変わるので、閉じる操作にはこれを使う。 */
export function CloseIcon({ className }: { className?: string }): ReactElement {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={cn("size-5 shrink-0", className)}
        >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}

const SIZE_CLASS = {
    // ダイアログの右上
    md: { button: "p-2 rounded-lg", icon: "size-5" },
    // 通知や帯の中
    sm: { button: "p-1 rounded-md", icon: "size-4" },
} as const;

/** 「×」だけの閉じるボタン。`DialogClose asChild` の中にも置ける。 */
export function CloseIconButton({
    size = "md",
    className,
    "aria-label": ariaLabel = "閉じる",
    ...props
}: ComponentPropsWithRef<"button"> & { size?: keyof typeof SIZE_CLASS }): ReactElement {
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            className={cn(
                "inline-flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                SIZE_CLASS[size].button,
                className,
            )}
            {...props}
        >
            <CloseIcon className={SIZE_CLASS[size].icon} />
        </button>
    );
}
