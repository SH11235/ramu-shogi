import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import {
    BackTenIcon,
    FirstIcon,
    ForwardTenIcon,
    LastIcon,
    NextIcon,
    PrevIcon,
} from "../../study-workspace/StudyIcons";

interface MobileNavigationProps {
    /** 現在の手数 */
    currentPly: number;
    /** 総手数 */
    totalPly: number;
    onBack: () => void;
    onForward: () => void;
    onToStart: () => void;
    onToEnd: () => void;
    onBackTen: () => void;
    onForwardTen: () => void;
    /** 無効状態 */
    disabled?: boolean;
    /** 進めるか（分岐の途中など、手数だけでは決まらないときに渡す） */
    canGoForward?: boolean;
    /** 手数の表示の代わりに置くもの（研究ノートで変化に入っている間の「本譜へ」など） */
    center?: ReactNode;
    className?: string;
}

// 見た目は研究ノートの手送り（StudyIconButton）と合わせている。変えるときは両方をそろえる。
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
 * スマートフォンの手送りの行。どの画面でも同じ 7 つの操作だけを並べる（画面ごとのボタンはこの行に
 * 置かない）。40px のボタン 6 つと手数で約 320px にし、375px 幅の画面に詰めずに収める。
 */
export function MobileNavigation({
    currentPly,
    totalPly,
    onBack,
    onForward,
    onToStart,
    onToEnd,
    onBackTen,
    onForwardTen,
    disabled = false,
    canGoForward: canGoForwardProp,
    center,
    className,
}: MobileNavigationProps): ReactElement {
    const canGoBack = !disabled && currentPly > 0;
    const canGoForward = !disabled && (canGoForwardProp ?? currentPly < totalPly);

    return (
        <nav
            aria-label="局面の移動"
            className={cn("flex items-center justify-center gap-1", className)}
        >
            <MobileNavButton title="最初へ" onClick={onToStart} disabled={!canGoBack}>
                <FirstIcon className="h-5 w-5" />
            </MobileNavButton>
            <MobileNavButton title="10手戻る" onClick={onBackTen} disabled={!canGoBack}>
                <BackTenIcon className="h-5 w-5" />
            </MobileNavButton>
            <MobileNavButton title="1手戻る" onClick={onBack} disabled={!canGoBack}>
                <PrevIcon className="h-5 w-5" />
            </MobileNavButton>
            <div className="flex min-w-14 justify-center">
                {center ?? (
                    <output className="text-center font-mono text-sm tabular-nums text-wafuu-sumi">
                        {currentPly}/{totalPly}
                    </output>
                )}
            </div>
            <MobileNavButton title="1手進む" onClick={onForward} disabled={!canGoForward}>
                <NextIcon className="h-5 w-5" />
            </MobileNavButton>
            <MobileNavButton title="10手進む" onClick={onForwardTen} disabled={!canGoForward}>
                <ForwardTenIcon className="h-5 w-5" />
            </MobileNavButton>
            <MobileNavButton title="最後へ" onClick={onToEnd} disabled={!canGoForward}>
                <LastIcon className="h-5 w-5" />
            </MobileNavButton>
        </nav>
    );
}
