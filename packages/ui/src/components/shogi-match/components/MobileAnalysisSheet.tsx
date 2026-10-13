/**
 * スマホ向けの「グラフ・読み筋」シート
 *
 * 評価値の行のボタンから開く。評価値グラフと、いま見ている手の読み筋を 1 枚にまとめる。
 * 指し手を押しただけでは開かない（局面が移るだけ）。開いている間は、見ている手に追従する。
 */

import type { PositionState } from "@shogi/app-core";
import type { ReactElement } from "react";
import type { EvalHistory, KifMove, PvDisplayMove, PvEvalInfo } from "../utils/kifFormat";
import { convertPvToDisplay, formatEval, getEvalTooltipInfo } from "../utils/kifFormat";
import { formatElapsedTime } from "../utils/timeFormat";
import { BottomSheet } from "./BottomSheet";
import { EvalGraph } from "./EvalGraph";
import { MobileNavigation } from "./MobileNavigation";

interface MobileAnalysisSheetProps {
    /** シートを開くかどうか */
    open: boolean;
    /** 開閉状態変更時のコールバック */
    onOpenChange: (open: boolean) => void;
    /** 評価値の履歴（グラフ用） */
    evalHistory: EvalHistory[];
    /** いま見ている手数 */
    currentPly: number;
    /** 総手数 */
    totalPly: number;
    /** いま見ている手（開始局面では null） */
    move: KifMove | null;
    /** その手が指された後の局面 */
    position: PositionState | null;
    /** グラフで手数を選んだとき */
    onPlySelect: (ply: number) => void;
    onBack: () => void;
    onForward: () => void;
    onToStart: () => void;
    onToEnd: () => void;
    /** PVを分岐として追加するコールバック */
    onAddBranch?: (ply: number, pv: string[]) => void;
    /** PVを盤面で確認するコールバック */
    onPreview?: (ply: number, pv: string[], evalCp?: number, evalMate?: number) => void;
    /** 現在位置がメインライン上にあるか */
    isOnMainLine?: boolean;
}

/**
 * スマホ向けPV候補アイテム
 * タッチ操作に最適化したサイズ・余白
 */
function MobilePvCandidateItem({
    pv,
    position,
    ply,
    onAddBranch,
    onPreview,
    onClose,
    isOnMainLine,
}: {
    pv: PvEvalInfo;
    position: PositionState;
    ply: number;
    onAddBranch?: (ply: number, pvMoves: string[]) => void;
    onPreview?: (ply: number, pvMoves: string[], evalCp?: number, evalMate?: number) => void;
    onClose: () => void;
    isOnMainLine: boolean;
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

    const hasPv = pvDisplay && pvDisplay.length > 0;

    return (
        <div className="border border-border rounded-xl p-3 bg-muted/30">
            {/* ヘッダー: 候補番号 + 評価値 */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium bg-muted px-2 py-1 rounded-md">
                        候補{pv.multipv}
                    </span>
                    <span
                        className={`font-semibold font-mono tabular-nums text-base ${
                            evalInfo.advantage === "sente"
                                ? "text-wafuu-shu"
                                : evalInfo.advantage === "gote"
                                  ? "text-wafuu-ai"
                                  : ""
                        }`}
                    >
                        {formatEval(pv.evalCp, pv.evalMate, ply)}
                    </span>
                </div>
                {pv.depth && <span className="text-xs text-muted-foreground">深さ{pv.depth}</span>}
            </div>

            {/* 読み筋 */}
            {hasPv && (
                <div className="flex flex-wrap gap-1 text-sm font-mono tabular-nums mb-3">
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

            {/* アクションボタン（タッチ操作に最適化） */}
            {/* hasPv が true なら pv.pv は必ず存在する（pvDisplay の生成条件より） */}
            {hasPv && (onPreview || onAddBranch) && (
                <div className="flex gap-2">
                    {onPreview && (
                        <button
                            type="button"
                            onClick={() => {
                                onClose(); // BottomSheetを閉じてからプレビュー
                                onPreview(ply, pv.pv ?? [], pv.evalCp, pv.evalMate);
                            }}
                            className="
                                flex-1 px-4 py-3 text-sm font-medium
                                bg-primary text-primary-foreground
                                rounded-lg
                                active:scale-95 transition-transform
                            "
                        >
                            ▶ 盤面で確認
                        </button>
                    )}
                    {onAddBranch && isOnMainLine && (
                        <button
                            type="button"
                            onClick={() => {
                                onAddBranch(ply, pv.pv ?? []);
                                onClose();
                            }}
                            className="
                                flex-1 px-4 py-3 text-sm font-medium
                                bg-muted hover:bg-muted/80
                                rounded-lg border border-border
                                active:scale-95 transition-transform
                            "
                        >
                            📂 分岐保存
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

/** 複数PVがあればそのリスト、なければ単一PVを 1 件のリストにする。 */
function collectPvList(move: KifMove | null): PvEvalInfo[] {
    if (!move) return [];
    const multiPv = (move.multiPvEvals ?? []).filter((pv) => pv?.pv && pv.pv.length > 0);
    if (multiPv.length > 0) return multiPv;
    if (move.pv && move.pv.length > 0) {
        return [
            {
                multipv: 1,
                evalCp: move.evalCp,
                evalMate: move.evalMate,
                depth: move.depth,
                pv: move.pv,
            },
        ];
    }
    return [];
}

/**
 * スマホ向けの「グラフ・読み筋」シート
 */
export function MobileAnalysisSheet({
    open,
    onOpenChange,
    evalHistory,
    currentPly,
    totalPly,
    move,
    position,
    onPlySelect,
    onBack,
    onForward,
    onToStart,
    onToEnd,
    onAddBranch,
    onPreview,
    isOnMainLine = true,
}: MobileAnalysisSheetProps): ReactElement {
    const handleClose = () => onOpenChange(false);
    const pvList = collectPvList(move);
    const evalText = move ? formatEval(move.evalCp, move.evalMate, move.ply) : "";
    // 評価値の色は符号ではなく指した側（先手 = 朱、後手 = 藍。グラフと一致）。
    const mover = move ? (move.mover ?? (move.ply % 2 === 1 ? "sente" : "gote")) : null;

    return (
        <BottomSheet
            open={open}
            onOpenChange={onOpenChange}
            title="グラフ・読み筋"
            height="auto"
            // 盤を見ながらグラフをなぞれるよう、背後を暗くしない。
            overlay="transparent"
        >
            <div className="flex flex-col gap-3">
                {/* グラフ。押す・なぞると、その辺りの局面へ移る（シートは閉じない）。 */}
                <EvalGraph
                    evalHistory={evalHistory}
                    currentPly={currentPly}
                    compact
                    height={96}
                    // 詰みや大差の値で全体が平らにならないよう、縦軸に上限を置く（研究ノートと同じ）。
                    minScale={1000}
                    axisCap={3000}
                    onPlySelect={onPlySelect}
                    scrubbable
                />

                {/* いま見ている手。グラフでは 1 手単位に合わせにくいので、ここで前後に送る。 */}
                <div className="flex items-baseline justify-center gap-2 text-sm">
                    {move ? (
                        <>
                            <span className="font-semibold">{move.displayText}</span>
                            {evalText !== "" && (
                                <span
                                    className={`font-mono font-semibold tabular-nums ${
                                        mover === "sente" ? "text-wafuu-shu" : "text-wafuu-ai"
                                    }`}
                                >
                                    {evalText}
                                </span>
                            )}
                            {move.elapsedMs !== undefined && (
                                <span className="text-xs text-muted-foreground">
                                    消費 {formatElapsedTime(move.elapsedMs)}
                                </span>
                            )}
                        </>
                    ) : (
                        <span className="text-muted-foreground">開始局面</span>
                    )}
                </div>
                <MobileNavigation
                    currentPly={currentPly}
                    totalPly={totalPly}
                    onBack={onBack}
                    onForward={onForward}
                    onToStart={onToStart}
                    onToEnd={onToEnd}
                />

                {/* 読み筋 */}
                {move && position && pvList.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        {pvList.map((pv) => (
                            <MobilePvCandidateItem
                                key={pv.multipv}
                                pv={pv}
                                position={position}
                                ply={move.ply}
                                onAddBranch={onAddBranch}
                                onPreview={onPreview}
                                onClose={handleClose}
                                isOnMainLine={isOnMainLine}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="py-3 text-center text-sm text-muted-foreground">
                        この手の読み筋はありません
                    </div>
                )}
            </div>
        </BottomSheet>
    );
}
