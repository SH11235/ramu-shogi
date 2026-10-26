import type { KifuTree, PositionState } from "@shogi/app-core";
import type { ReactElement } from "react";
import type { PvMainLineComparison } from "../utils/branchTreeUtils";
import { comparePvWithMainLine, findExistingBranchForPv } from "../utils/branchTreeUtils";
import type { PvDisplayMove, PvEvalInfo } from "../utils/kifFormat";
import { convertPvToDisplay, formatEval, getEvalTooltipInfo } from "../utils/kifFormat";

/**
 * 単一のPV候補を表示するコンポーネント
 */
export function PvCandidateItem({
    pv,
    position,
    ply,
    onAddBranch,
    onPreview,
    isOnMainLine,
    kifuTree,
}: {
    pv: PvEvalInfo;
    position: PositionState;
    ply: number;
    onAddBranch?: (ply: number, pvMoves: string[]) => void;
    onPreview?: (ply: number, pvMoves: string[], evalCp?: number, evalMate?: number) => void;
    isOnMainLine: boolean;
    kifuTree?: KifuTree;
}): ReactElement {
    // PVをKIF形式に変換
    const pvDisplay: PvDisplayMove[] | null = (() => {
        if (!pv.pv || pv.pv.length === 0) {
            return null;
        }
        return convertPvToDisplay(pv.pv, position);
    })();

    // 評価値の詳細情報
    const evalInfo = getEvalTooltipInfo(pv.evalCp, pv.evalMate, ply, pv.depth);

    // PVと本譜の比較結果
    const pvComparison: PvMainLineComparison | null = (() => {
        if (!kifuTree || !pv.pv || pv.pv.length === 0) {
            return null;
        }
        return comparePvWithMainLine(kifuTree, ply, pv.pv);
    })();

    // 分岐追加時のPVが既存分岐と一致するかをチェック
    const existingBranchNodeId: string | null = (() => {
        if (!kifuTree || !pv.pv || pv.pv.length === 0 || !pvComparison) {
            return null;
        }

        if (pvComparison.type === "diverges_later" && pvComparison.divergePly !== undefined) {
            const pvFromDiverge = pv.pv.slice(pvComparison.divergeIndex);
            return findExistingBranchForPv(kifuTree, pvComparison.divergePly, pvFromDiverge);
        }

        if (pvComparison.type === "diverges_first") {
            return findExistingBranchForPv(kifuTree, ply, pv.pv);
        }

        return null;
    })();

    const hasPv = pvDisplay && pvDisplay.length > 0;

    return (
        <div
            className="
                border border-border rounded-lg p-2
                bg-wafuu-washi/30
            "
        >
            {/* ヘッダー: 候補番号 + 評価値 */}
            <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-medium bg-muted px-1.5 py-0.5 rounded">
                    候補{pv.multipv}
                </span>
                <span
                    className={`font-medium font-mono tabular-nums text-[13px] ${
                        evalInfo.advantage === "sente"
                            ? "text-wafuu-shu"
                            : evalInfo.advantage === "gote"
                              ? "text-wafuu-ai"
                              : ""
                    }`}
                >
                    {formatEval(pv.evalCp, pv.evalMate, ply)}
                </span>
                {pv.depth && (
                    <span className="text-[10px] text-muted-foreground">深さ{pv.depth}</span>
                )}
            </div>

            {/* 読み筋 */}
            {hasPv && (
                <div className="flex flex-wrap gap-1 text-[12px] font-mono tabular-nums mb-2">
                    {pvDisplay.map((m, index) => (
                        <span
                            key={m.usiMove}
                            className={m.turn === "sente" ? "text-wafuu-shu" : "text-wafuu-ai"}
                        >
                            {m.displayText}
                            {index < pvDisplay.length - 1 && (
                                <span className="text-muted-foreground mx-0.5">→</span>
                            )}
                        </span>
                    ))}
                </div>
            )}

            {/* アクションボタン */}
            {/* hasPv が true なら pv.pv は必ず存在する（pvDisplay の生成条件より） */}
            {hasPv && (onPreview || onAddBranch) && (
                <div className="flex gap-2">
                    {onPreview && (
                        <button
                            type="button"
                            onClick={() => onPreview(ply, pv.pv ?? [], pv.evalCp, pv.evalMate)}
                            className="
                                flex-1 px-2 py-1 text-[11px]
                                bg-muted hover:bg-muted/80
                                rounded border border-border
                                transition-colors cursor-pointer
                            "
                        >
                            <span className="mr-1">▶</span>
                            盤面で確認
                        </button>
                    )}
                    {onAddBranch &&
                        (isOnMainLine ? (
                            <>
                                {/* 本譜と完全一致の場合 */}
                                {pvComparison?.type === "identical" && (
                                    <div
                                        className="
                                            flex-1 px-2 py-1 text-[11px] text-center
                                            bg-muted/50 text-muted-foreground
                                            rounded border border-border
                                        "
                                    >
                                        <span className="mr-1">✓</span>
                                        本譜通り
                                    </div>
                                )}
                                {/* 途中から分岐する場合 */}
                                {pvComparison?.type === "diverges_later" &&
                                    pvComparison.divergePly !== undefined &&
                                    pvComparison.divergeIndex !== undefined &&
                                    (existingBranchNodeId ? (
                                        <div
                                            className="
                                                flex-1 px-2 py-1 text-[11px] text-center
                                                bg-muted/50 text-muted-foreground
                                                rounded border border-border
                                            "
                                        >
                                            <span className="mr-1">✓</span>
                                            分岐追加済み
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const pvFromDiverge = pv.pv?.slice(
                                                    pvComparison.divergeIndex,
                                                );
                                                if (
                                                    pvFromDiverge &&
                                                    pvFromDiverge.length > 0 &&
                                                    pvComparison.divergePly !== undefined
                                                ) {
                                                    onAddBranch(
                                                        pvComparison.divergePly,
                                                        pvFromDiverge,
                                                    );
                                                }
                                            }}
                                            className="
                                                flex-1 px-2 py-1 text-[11px]
                                                bg-wafuu-kin/10 hover:bg-wafuu-kin/20
                                                text-wafuu-sumi
                                                rounded border border-wafuu-kin/30
                                                transition-colors cursor-pointer
                                            "
                                        >
                                            <span className="mr-1">📂</span>
                                            {pvComparison.divergePly + 1}手目から分岐
                                        </button>
                                    ))}
                                {/* 最初から異なる場合 */}
                                {(pvComparison?.type === "diverges_first" || !pvComparison) &&
                                    (existingBranchNodeId ? (
                                        <div
                                            className="
                                                flex-1 px-2 py-1 text-[11px] text-center
                                                bg-muted/50 text-muted-foreground
                                                rounded border border-border
                                            "
                                        >
                                            <span className="mr-1">✓</span>
                                            分岐追加済み
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => onAddBranch(ply, pv.pv ?? [])}
                                            className="
                                                flex-1 px-2 py-1 text-[11px]
                                                bg-muted hover:bg-muted/80
                                                rounded border border-border
                                                transition-colors cursor-pointer
                                            "
                                        >
                                            <span className="mr-1">📂</span>
                                            分岐として保存
                                        </button>
                                    ))}
                            </>
                        ) : (
                            <div
                                className="
                                    flex-1 px-2 py-1 text-[11px] text-center
                                    bg-muted/30 text-muted-foreground
                                    rounded border border-border/50
                                "
                                title="分岐上にいるため、本譜への分岐追加は利用できません"
                            >
                                <span className="mr-1 opacity-50">📂</span>
                                本譜に戻ると分岐追加可能
                            </div>
                        ))}
                </div>
            )}
        </div>
    );
}
