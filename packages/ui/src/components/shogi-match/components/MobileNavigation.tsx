import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { FirstIcon, LastIcon, NextIcon, PrevIcon } from "../../study-workspace/StudyIcons";
import { MobileSettingsActions } from "./MobileSettingsActions";

interface MobileNavigationProps {
    /** 現在の手数 */
    currentPly: number;
    /** 総手数 */
    totalPly: number;
    /** 戻るボタン */
    onBack: () => void;
    /** 進むボタン */
    onForward: () => void;
    /** 最初へ */
    onToStart: () => void;
    /** 最後へ */
    onToEnd: () => void;
    /** 無効状態 */
    disabled?: boolean;
    /** 設定ボタンクリック（指定時は右端に設定ボタンを表示） */
    onSettingsClick?: () => void;
    /** AI（評価関数）ボタンクリック（指定時は設定ボタンの左に表示） */
    onNnueManagerClick?: () => void;
}

// 研究ノートの手送り（StudyIconButton）と同じ、アイコンだけの 40px のボタン。
function MobileNavButton({
    title,
    onClick,
    disabled,
    children,
}: {
    title: string;
    onClick: () => void;
    disabled: boolean;
    children: ReactNode;
}): ReactElement {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            aria-label={title}
            className={cn(
                "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-wafuu-sumi transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                disabled ? "cursor-not-allowed opacity-40" : "hover:bg-muted/60 active:bg-muted",
            )}
        >
            {children}
        </button>
    );
}

/**
 * スマホ検討モード用のナビゲーションボタン
 */
export function MobileNavigation({
    currentPly,
    totalPly,
    onBack,
    onForward,
    onToStart,
    onToEnd,
    disabled = false,
    onSettingsClick,
    onNnueManagerClick,
}: MobileNavigationProps): ReactElement {
    const canGoBack = currentPly > 0;
    const canGoForward = currentPly < totalPly;

    return (
        <div className="flex items-center justify-center gap-2 py-2">
            <MobileNavButton title="最初へ" onClick={onToStart} disabled={disabled || !canGoBack}>
                <FirstIcon className="h-5 w-5" />
            </MobileNavButton>
            <MobileNavButton title="1手戻る" onClick={onBack} disabled={disabled || !canGoBack}>
                <PrevIcon className="h-5 w-5" />
            </MobileNavButton>

            <div className="min-w-[60px] text-center font-mono text-sm tabular-nums text-wafuu-sumi">
                {currentPly} / {totalPly}
            </div>

            <MobileNavButton
                title="1手進む"
                onClick={onForward}
                disabled={disabled || !canGoForward}
            >
                <NextIcon className="h-5 w-5" />
            </MobileNavButton>
            <MobileNavButton title="最後へ" onClick={onToEnd} disabled={disabled || !canGoForward}>
                <LastIcon className="h-5 w-5" />
            </MobileNavButton>

            <MobileSettingsActions
                variant="navigation"
                onSettingsClick={onSettingsClick}
                onNnueManagerClick={onNnueManagerClick}
            />
        </div>
    );
}
