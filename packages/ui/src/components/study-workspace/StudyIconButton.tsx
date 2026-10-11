import { cn } from "@shogi/design-system";
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip";

interface StudyIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /** ボタンの意味。読み上げ（`aria-label`）とツールチップの両方に使う。 */
    label: string;
    /** 押された状態（切り替えボタンのとき）。 */
    pressed?: boolean;
    children: ReactNode;
}

/**
 * アイコンだけのボタン。必ずラベルを持ち、ツールチップでも同じ文言を出す。
 * 指でも押しやすいよう、押せる範囲は 40px 四方にしている。
 * `TooltipProvider` の内側で使うこと。
 */
export function StudyIconButton({
    label,
    pressed,
    className,
    children,
    ...props
}: StudyIconButtonProps): ReactElement {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    aria-pressed={pressed}
                    className={cn(
                        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-transparent text-wafuu-sumi-light transition-colors hover:bg-muted/60 hover:text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
                        pressed && "border-wafuu-border bg-wafuu-kin/20 text-wafuu-sumi",
                        className,
                    )}
                    {...props}
                >
                    {children}
                </button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
