import { cn } from "@shogi/design-system";
import { ChevronIcon } from "../../chevron-icon";
import {
    BackTenIcon,
    FirstIcon,
    ForwardTenIcon,
    LastIcon,
    NextIcon,
    PrevIcon,
} from "../../study-workspace/StudyIcons";
/**
 * 棋譜ナビゲーションツールバー
 *
 * 前へ/次へ/最初へ/最後へのナビゲーションボタンと
 * 分岐切替機能を提供する
 */

import type { ReactElement } from "react";
import { useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../../popover";
import { handleMenuKeyDown } from "../utils/menuKeyNavigation";

export const KIFU_NAV_STEP_TEN = 10;

interface BranchInfo {
    hasBranches: boolean;
    currentIndex: number;
    count: number;
    onSwitch: (index: number) => void;
    /** メインラインに昇格 */
    onPromoteToMain?: () => void;
}

interface KifuNavigationToolbarProps {
    /** 現在の手数 */
    currentPly: number;
    /** 最大手数（メインライン） */
    totalPly: number;
    /** 1手戻る */
    onBack: () => void;
    /** 1手進む */
    onForward: () => void;
    /** 最初へ */
    onToStart: () => void;
    /** 最後へ */
    onToEnd: () => void;
    /** 10 手戻る・10 手進む。渡したときだけ出す。 */
    onBackTen?: () => void;
    onForwardTen?: () => void;
    /** 無効化（対局中など） */
    disabled?: boolean;
    /** 分岐情報 */
    branchInfo?: BranchInfo;
    /** 巻き戻し中か */
    isRewound?: boolean;
    /** 進む操作が可能か（現在ノードに子がある） */
    canGoForward?: boolean;
    /**
     * "large": 押しやすい大きさのボタンで、欄の幅いっぱいに並べる（終局後の振り返りなど、主な操作にするとき）。
     */
    size?: "default" | "large";
    className?: string;
}

/**
 * ナビゲーションボタン
 */
function NavButton({
    onClick,
    disabled,
    title,
    large = false,
    children,
}: {
    onClick: () => void;
    disabled?: boolean;
    title: string;
    large?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            aria-label={title}
            // 見た目は研究ノートの手送り（StudyIconButton）と合わせている。変えるときは両方をそろえる。
            className={cn(
                large ? "h-10 min-w-12 flex-1" : "h-8 w-8",
                "inline-flex items-center justify-center rounded-md border border-border bg-background text-wafuu-sumi transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                disabled ? "cursor-not-allowed opacity-40" : "hover:bg-muted/60 active:bg-muted",
            )}
        >
            {children}
        </button>
    );
}

export function KifuNavigationToolbar({
    currentPly,
    totalPly,
    onBack,
    onForward,
    onToStart,
    onToEnd,
    onBackTen,
    onForwardTen,
    disabled = false,
    branchInfo,
    isRewound = false,
    canGoForward: canGoForwardProp,
    size = "default",
    className,
}: KifuNavigationToolbarProps): ReactElement {
    const large = size === "large";
    const [showBranchMenu, setShowBranchMenu] = useState(false);
    const branchMenuRef = useRef<HTMLDivElement>(null);

    const canGoBack = currentPly > 0;
    // canGoForward: propsで明示されていればそれを使用、そうでなければ従来の計算
    const canGoForward = canGoForwardProp ?? currentPly < totalPly;

    const handleBranchSelect = (index: number) => {
        branchInfo?.onSwitch(index);
        setShowBranchMenu(false);
    };

    return (
        <div
            className={cn(
                large ? "flex w-full items-center gap-2" : "flex items-center gap-1.5",
                className,
            )}
        >
            {/* 最初へ */}
            <NavButton
                onClick={onToStart}
                disabled={disabled || !canGoBack}
                title="最初へ戻る"
                large={large}
            >
                <FirstIcon className={large ? "h-5 w-5" : undefined} />
            </NavButton>
            {onBackTen && (
                <NavButton
                    onClick={onBackTen}
                    disabled={disabled || !canGoBack}
                    title="10手戻る"
                    large={large}
                >
                    <BackTenIcon className={large ? "h-5 w-5" : undefined} />
                </NavButton>
            )}
            {/* 1手戻る */}
            <NavButton
                onClick={onBack}
                disabled={disabled || !canGoBack}
                title="1手戻る"
                large={large}
            >
                <PrevIcon className={large ? "h-5 w-5" : undefined} />
            </NavButton>

            {/* 手数表示 */}
            <div
                className={`
                    ${large ? "min-w-16 shrink-0 text-sm tabular-nums" : "flex-1 text-[13px]"} text-center font-medium
                    ${isRewound ? "text-wafuu-shu" : "text-foreground"}
                `}
            >
                {currentPly}/{totalPly}手
            </div>

            {/* 1手進む */}
            <NavButton
                onClick={onForward}
                disabled={disabled || !canGoForward}
                title="1手進む"
                large={large}
            >
                <NextIcon className={large ? "h-5 w-5" : undefined} />
            </NavButton>

            {onForwardTen && (
                <NavButton
                    onClick={onForwardTen}
                    disabled={disabled || !canGoForward}
                    title="10手進む"
                    large={large}
                >
                    <ForwardTenIcon className={large ? "h-5 w-5" : undefined} />
                </NavButton>
            )}
            {/* 最後へ */}
            <NavButton
                onClick={onToEnd}
                disabled={disabled || !canGoForward}
                title="最後へ進む"
                large={large}
            >
                <LastIcon className={large ? "h-5 w-5" : undefined} />
            </NavButton>

            {/* 分岐切替（分岐がある場合のみ表示） */}
            {branchInfo?.hasBranches && (
                <Popover open={showBranchMenu} onOpenChange={setShowBranchMenu}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            disabled={disabled}
                            title={`分岐 ${branchInfo.currentIndex + 1}/${branchInfo.count}`}
                            className={`
                                px-2 h-8 flex items-center gap-1
                                rounded border border-border bg-background
                                text-foreground text-[12px]
                                transition-colors duration-150
                                ${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-accent cursor-pointer"}
                            `}
                        >
                            <span>分岐</span>
                            <span className="text-wafuu-shu font-medium">
                                {branchInfo.currentIndex + 1}/{branchInfo.count}
                            </span>
                            <ChevronIcon />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        side="bottom"
                        align="end"
                        sideOffset={4}
                        className="w-auto min-w-[100px] overflow-hidden p-0"
                        // 先頭ではなく今の分岐から矢印キーで動けるようにする
                        onOpenAutoFocus={(event) => {
                            event.preventDefault();
                            branchMenuRef.current
                                ?.querySelector<HTMLElement>('[aria-checked="true"]')
                                ?.focus();
                        }}
                    >
                        <div
                            ref={branchMenuRef}
                            role="menu"
                            aria-label="分岐選択"
                            onKeyDown={(event) =>
                                handleMenuKeyDown(event, {
                                    itemSelector: '[role^="menuitem"]',
                                    onClose: () => setShowBranchMenu(false),
                                })
                            }
                        >
                            {Array.from({ length: branchInfo.count }, (_, i) => i).map((index) => (
                                <button
                                    type="button"
                                    key={index}
                                    onClick={() => handleBranchSelect(index)}
                                    role="menuitemradio"
                                    tabIndex={-1}
                                    aria-checked={index === branchInfo.currentIndex}
                                    className={`
                                        w-full px-3 py-1.5 text-left text-[12px]
                                        transition-colors duration-150
                                        focus-visible:outline-none focus-visible:bg-accent
                                        ${
                                            index === branchInfo.currentIndex
                                                ? "bg-accent font-medium"
                                                : "hover:bg-accent/50"
                                        }
                                    `}
                                >
                                    変化 {index + 1}
                                    {index === 0 && (
                                        <span className="ml-1 text-[10px] text-muted-foreground">
                                            (メイン)
                                        </span>
                                    )}
                                </button>
                            ))}
                            {/* メインに昇格ボタン（メイン以外の分岐を選択中の場合） */}
                            {branchInfo.currentIndex > 0 && branchInfo.onPromoteToMain && (
                                <>
                                    <div
                                        className="border-t border-border my-1"
                                        aria-hidden="true"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            branchInfo.onPromoteToMain?.();
                                            setShowBranchMenu(false);
                                        }}
                                        role="menuitem"
                                        tabIndex={-1}
                                        className="w-full px-3 py-1.5 text-left text-[12px] text-wafuu-shu hover:bg-accent/50 focus-visible:outline-none focus-visible:bg-accent/50 transition-colors duration-150"
                                    >
                                        ★ メインに昇格
                                    </button>
                                </>
                            )}
                        </div>
                    </PopoverContent>
                </Popover>
            )}
        </div>
    );
}
