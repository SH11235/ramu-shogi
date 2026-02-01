import type { Player } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import type { ClockSettings, TickState } from "../hooks/useClockManager";
import { formatTime } from "../utils/timeFormat";
import { PlayerIcon } from "./PlayerIcon";

interface ClockDisplayProps {
    /** 時計の状態 */
    clocks: TickState;
    /** 時間設定（時間制限のオンオフ判定用） */
    timeSettings: ClockSettings;
    /** 対局が進行中かどうか */
    isRunning?: boolean;
    /** 追加のクラス名（スペーシング等は親から指定） */
    className?: string;
    /** 中央に表示するコンテンツ（手数、反転ボタンなど） */
    centerContent?: ReactNode;
}

/**
 * コンパクトクロック表示
 * 対局中に盤面の上に横並びで表示
 * 非対局時はグレーアウト表示
 */
export function ClockDisplay({
    clocks,
    timeSettings,
    isRunning = true,
    className,
    centerContent,
}: ClockDisplayProps): ReactElement {
    const renderClock = (side: Player) => {
        const clock = clocks[side];
        const ticking = isRunning && clocks.ticking === side;
        const timeEnabled = timeSettings[side].enabled;

        return (
            <div
                className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-opacity",
                    ticking ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/50",
                    !isRunning && "opacity-50",
                )}
            >
                <PlayerIcon side={side} size="sm" />
                <span className="font-mono text-sm tabular-nums">
                    {timeEnabled ? (
                        <>
                            {formatTime(clock.mainMs)}
                            <span className="text-muted-foreground">+</span>
                            {formatTime(clock.byoyomiMs)}
                        </>
                    ) : (
                        <span className="text-lg">∞</span>
                    )}
                </span>
                <span
                    className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        ticking ? "bg-primary animate-pulse" : "invisible",
                    )}
                />
            </div>
        );
    };

    return (
        <div className={cn("flex items-center justify-between gap-1", className)}>
            {renderClock("sente")}
            {centerContent && <div className="flex items-center gap-1">{centerContent}</div>}
            {renderClock("gote")}
        </div>
    );
}
