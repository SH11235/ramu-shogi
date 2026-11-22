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
}: {
    index: number;
    total: number;
    onToStart: () => void;
    onBack: () => void;
    onForward: () => void;
    onToEnd: () => void;
    onBackTen: () => void;
    onForwardTen: () => void;
}): ReactElement {
    const buttonClass = "w-12 border-border bg-background text-wafuu-sumi";
    return (
        <nav aria-label="局面の移動" className="flex items-center justify-center gap-1.5">
            <StudyIconButton
                label="最初の局面へ"
                className={buttonClass}
                onClick={onToStart}
                disabled={index <= 0}
            >
                <FirstIcon />
            </StudyIconButton>
            <StudyIconButton
                label="10 手戻る"
                className={buttonClass}
                onClick={onBackTen}
                disabled={index <= 0}
            >
                <BackTenIcon />
            </StudyIconButton>
            <StudyIconButton
                label="1 手戻る（←）"
                className={buttonClass}
                onClick={onBack}
                disabled={index <= 0}
            >
                <PrevIcon />
            </StudyIconButton>
            <output className="min-w-[4.5rem] text-center font-mono text-sm tabular-nums text-wafuu-sumi">
                {`${index} / ${total}`}
            </output>
            <StudyIconButton
                label="1 手進む（→）"
                className={buttonClass}
                onClick={onForward}
                disabled={index >= total}
            >
                <NextIcon />
            </StudyIconButton>
            <StudyIconButton
                label="10 手進む"
                className={buttonClass}
                onClick={onForwardTen}
                disabled={index >= total}
            >
                <ForwardTenIcon />
            </StudyIconButton>
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
