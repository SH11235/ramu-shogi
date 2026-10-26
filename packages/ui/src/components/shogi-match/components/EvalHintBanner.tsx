import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";

/**
 * 評価値ヒントバナー
 * 評価値がOFFだがデータが存在する場合に表示
 */
export function EvalHintBanner({
    onEnable,
    onDismiss,
    className,
}: {
    onEnable: () => void;
    onDismiss: () => void;
    className?: string;
}): ReactElement {
    return (
        <div
            className={cn(
                "relative overflow-hidden bg-gradient-to-r from-wafuu-washi-warm to-wafuu-washi border border-wafuu-kin/40 rounded-lg px-3 py-2 animate-[slideDown_0.3s_ease-out,fadeIn_0.3s_ease-out] shadow-[0_2px_8px_hsl(var(--wafuu-kin)/0.15)]",
                className,
            )}
        >
            {/* 金色のアクセントライン */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-wafuu-kin to-transparent opacity-60" />

            <div className="flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={onEnable}
                    className="
                        flex items-center gap-2 text-[12px] font-medium
                        text-wafuu-sumi
                        hover:text-wafuu-shu transition-colors
                        bg-transparent border-none cursor-pointer p-0
                    "
                >
                    <span
                        className="
                            inline-flex items-center justify-center
                            w-5 h-5 rounded-full
                            bg-wafuu-kin/20
                            text-wafuu-kin
                            animate-[pulse_2s_ease-in-out_infinite]
                        "
                    >
                        ✦
                    </span>
                    <span>評価値データがあります。表示しますか？</span>
                </button>

                <button
                    type="button"
                    onClick={onDismiss}
                    className="
                        flex items-center justify-center
                        w-5 h-5 rounded-full
                        text-muted-foreground
                        hover:text-foreground
                        hover:bg-muted
                        bg-transparent border-none cursor-pointer
                        transition-colors
                    "
                    aria-label="閉じる"
                >
                    ✕
                </button>
            </div>
        </div>
    );
}
