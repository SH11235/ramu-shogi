import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { StudyIconButton } from "./StudyIconButton";
import { BackTenIcon, FirstIcon, ForwardTenIcon, LastIcon, NextIcon, PrevIcon } from "./StudyIcons";

/** 局面の移動（最初・10 手戻る・1 手戻る・1 手進む・10 手進む・最後）と、いまの手数。 */
export function StudyNavBar({
    index,
    total,
    onToStart,
    onBack,
    onForward,
    onToEnd,
    onBackTen,
    onForwardTen,
    compact = false,
}: {
    index: number;
    total: number;
    onToStart: () => void;
    onBack: () => void;
    onForward: () => void;
    onToEnd: () => void;
    /** 10 手ずつの移動。`compact` のときは行に入らないので出さない。 */
    onBackTen?: () => void;
    onForwardTen?: () => void;
    /** スマートフォンで、同じ行にコメントのボタンも並べるときの詰めた幅 */
    compact?: boolean;
}): ReactElement {
    const buttonClass = cn(
        // 幅の狭い画面では、左に「本譜へ」の場所を空けるため細くする。
        compact ? "w-9 min-[375px]:w-10" : "w-12",
        "border-border bg-background text-wafuu-sumi",
    );
    return (
        <nav
            aria-label="局面の移動"
            className={cn(
                "flex items-center justify-center",
                compact ? "gap-1 min-[375px]:gap-1.5" : "gap-1.5",
            )}
        >
            <StudyIconButton
                label="最初の局面へ"
                className={buttonClass}
                onClick={onToStart}
                disabled={index <= 0}
            >
                <FirstIcon />
            </StudyIconButton>
            {!compact && onBackTen && (
                <StudyIconButton
                    label="10 手戻る"
                    className={buttonClass}
                    onClick={onBackTen}
                    disabled={index <= 0}
                >
                    <BackTenIcon />
                </StudyIconButton>
            )}
            <StudyIconButton
                label="1 手戻る（←）"
                className={buttonClass}
                onClick={onBack}
                disabled={index <= 0}
            >
                <PrevIcon />
            </StudyIconButton>
            <output
                className={cn(
                    "text-center font-mono text-sm tabular-nums text-wafuu-sumi",
                    compact ? "min-w-[3.25rem] min-[375px]:min-w-[3.75rem]" : "min-w-[4.5rem]",
                )}
            >
                {/* 狭い行に入れるので、3 桁の手数でも幅が増えないよう空白を入れない。 */}
                {compact ? `${index}/${total}` : `${index} / ${total}`}
            </output>
            <StudyIconButton
                label="1 手進む（→）"
                className={buttonClass}
                onClick={onForward}
                disabled={index >= total}
            >
                <NextIcon />
            </StudyIconButton>
            {!compact && onForwardTen && (
                <StudyIconButton
                    label="10 手進む"
                    className={buttonClass}
                    onClick={onForwardTen}
                    disabled={index >= total}
                >
                    <ForwardTenIcon />
                </StudyIconButton>
            )}
            <StudyIconButton
                label="最後の局面へ"
                className={buttonClass}
                onClick={onToEnd}
                disabled={index >= total}
            >
                <LastIcon />
            </StudyIconButton>
        </nav>
    );
}
