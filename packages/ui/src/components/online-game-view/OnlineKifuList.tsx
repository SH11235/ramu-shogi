import type { PositionState } from "@shogi/app-core";
import type { ReactElement } from "react";
import { formatMoveSimple } from "../shogi-match/utils/kifFormat";

interface OnlineKifuListProps {
    usiMoveLog: ReadonlyArray<{ usi: string }>;
    positionHistory: ReadonlyArray<PositionState>;
    currentPly: number;
    /** 押せないときは、手を選んでも見ている局面を変えない */
    disabled: boolean;
    /** null は最新局面に追従する */
    onSelectPly: (navIndex: number | null) => void;
}

/** PC のサイドバーとスマホの BottomSheet で共通に出す棋譜の一覧 */
export function OnlineKifuList({
    usiMoveLog,
    positionHistory,
    currentPly,
    disabled,
    onSelectPly,
}: OnlineKifuListProps): ReactElement {
    return (
        <div className="flex flex-col gap-1 overflow-y-auto max-h-[50dvh] md:max-h-[calc(100dvh-160px)]">
            {usiMoveLog.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                    まだ指し手がありません
                </p>
            ) : (
                usiMoveLog.map((entry, i) => {
                    const ply = i + 1;
                    const pos = positionHistory[i];
                    const moveText = pos
                        ? formatMoveSimple(entry.usi, pos.turn, pos.board)
                        : entry.usi;
                    const isCurrentPly = currentPly === ply;
                    return (
                        <button
                            key={ply}
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                                onSelectPly(ply >= positionHistory.length - 1 ? null : ply)
                            }
                            className={`flex gap-2 text-xs px-2 py-1 rounded text-left transition-colors ${
                                isCurrentPly
                                    ? "bg-wafuu-kincha/20 text-wafuu-kincha font-medium"
                                    : "hover:bg-muted disabled:cursor-default"
                            }`}
                        >
                            <span className="text-muted-foreground w-6 shrink-0 tabular-nums">
                                {ply}.
                            </span>
                            <span>{moveText}</span>
                        </button>
                    );
                })
            )}
        </div>
    );
}
