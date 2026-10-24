/**
 * 終局の判子。盤の中央に肉球の判子を押し、掌の部分に終局の理由を白で抜く。
 * 終局のダイアログを閉じるまで残す（ダイアログの後ろで、何で終わったかを見せ続ける）。
 */

import type { GameResult, Player } from "@shogi/app-core";
import type { ReactElement } from "react";
import { useMatchState } from "../contexts/MatchStateContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";

const STAMP_LABEL: Record<GameResult["reason"]["kind"], string> = {
    resignation: "投了",
    checkmate: "詰み",
    time_expired: "時間切れ",
    win_declaration: "入玉宣言",
};

/** 人が投了ボタンで終えた対局か（自分で終えたので、判子での知らせは要らない） */
export function isSelfResignation(
    result: GameResult,
    sides: Record<Player, { role: string }>,
): boolean {
    return result.reason.kind === "resignation" && sides[result.reason.loser].role === "human";
}

export function PlayEndStamp(): ReactElement | null {
    const { play } = useShogiMatchConfig();
    const { sides } = useMatchState();
    const result = play?.gameResult;
    if (!play || !result || !play.resultDialogOpen || isSelfResignation(result, sides)) return null;
    const label = STAMP_LABEL[result.reason.kind];

    return (
        <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
        >
            {/* 傾きは外側に付ける（押す動きは transform を上書きするので、内側だけを動かす）。 */}
            <div className="-rotate-6">
                <div className="relative aspect-[5/4] w-[calc(var(--shogi-cell-size,48px)*4.2)] text-wafuu-shu opacity-90 delay-150 duration-300 ease-out fill-mode-both animate-in fade-in zoom-in-150 motion-reduce:animate-none">
                    <svg
                        aria-hidden="true"
                        viewBox="2 3 20 16"
                        fill="currentColor"
                        className="absolute inset-0 h-full w-full"
                    >
                        <ellipse cx="12" cy="14.6" rx="4.6" ry="3.8" />
                        <ellipse cx="5.6" cy="9.8" rx="1.8" ry="2.3" />
                        <ellipse cx="9.4" cy="6.2" rx="1.8" ry="2.3" />
                        <ellipse cx="14.6" cy="6.2" rx="1.8" ry="2.3" />
                        <ellipse cx="18.4" cy="9.8" rx="1.8" ry="2.3" />
                    </svg>
                    <span
                        className="absolute inset-x-0 top-[60%] text-center font-display font-semibold leading-none tracking-[0.12em] text-wafuu-shu-fg"
                        // 4 文字（時間切れ・入玉宣言）は、掌の幅に収まるよう小さくする。
                        style={{
                            fontSize: `calc(var(--shogi-cell-size, 48px) * ${label.length > 2 ? 0.36 : 0.5})`,
                        }}
                    >
                        {label}
                    </span>
                </div>
            </div>
        </div>
    );
}
