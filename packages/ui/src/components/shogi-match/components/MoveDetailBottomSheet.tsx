/**
 * スマホ向け指し手詳細BottomSheet
 *
 * 手をタップした時に表示される詳細パネル
 * 複数PV（読み筋）の表示と操作が可能
 */

import type { PositionState } from "@shogi/app-core";
import type { ReactElement } from "react";
import type { KifMove, PvDisplayMove, PvEvalInfo } from "../utils/kifFormat";
import { convertPvToDisplay, formatEval, getEvalTooltipInfo } from "../utils/kifFormat";
import { BottomSheet } from "./BottomSheet";

interface MoveDetailBottomSheetProps {
    /** シートを開くかどうか */
    open: boolean;
    /** 開閉状態変更時のコールバック */
    onOpenChange: (open: boolean) => void;
    /** 表示する手の情報 */
    move: KifMove | null;
    /** 対応する局面（手が指された後の局面） */
    position: PositionState | null;
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
                        className={`font-semibold text-base ${
                            evalInfo.advantage === "sente"
                                ? "text-wafuu-shu"
                                : evalInfo.advantage === "gote"
                                  ? "text-[hsl(210_70%_45%)]"
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
                <div className="flex flex-wrap gap-1 text-sm font-mono mb-3">
                    {pvDisplay.map((m, index) => (
                        <span
                            key={`${index}-${m.usiMove}`}
                            className={
                                m.turn === "sente" ? "text-wafuu-shu" : "text-[hsl(210_70%_45%)]"
                            }
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

/**
 * スマホ向け指し手詳細BottomSheet
 */
export function MoveDetailBottomSheet({
    open,
    onOpenChange,
    move,
    position,
    onAddBranch,
    onPreview,
    isOnMainLine = true,
}: MoveDetailBottomSheetProps): ReactElement | null {
    const handleClose = () => onOpenChange(false);
    // 複数PVがある場合はリストで表示、なければ従来の単一PVを使用
    const pvList: PvEvalInfo[] = (() => {
        if (!move) return [];

        const multiPv = (move.multiPvEvals ?? []).filter((pv) => pv?.pv && pv.pv.length > 0);
        if (multiPv.length > 0) {
            return multiPv;
        }
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
    })();

    // 評価値の詳細情報（ヘッダー用、最良の候補=multipv1のもの）
    const evalInfo = (() => {
        if (!move) return null;
        const bestPv = pvList[0];
        return getEvalTooltipInfo(
            bestPv?.evalCp ?? move.evalCp,
            bestPv?.evalMate ?? move.evalMate,
            move.ply,
            bestPv?.depth ?? move.depth,
        );
    })();

    if (!move || !position) return null;

    const hasPv = pvList.length > 0;
    const hasMultiplePv = pvList.length > 1;

    return (
        <BottomSheet
            open={open}
            onOpenChange={onOpenChange}
            title={`${move.ply}手目の候補`}
            height="auto"
        >
            <div className="space-y-4">
                {/* 指し手表示 */}
                <div className="text-center py-2">
                    <span className="text-2xl font-bold">{move.displayText}</span>
                    {evalInfo && (
                        <div className="mt-1">
                            <span
                                className={`text-lg font-semibold ${
                                    evalInfo.advantage === "sente"
                                        ? "text-wafuu-shu"
                                        : evalInfo.advantage === "gote"
                                          ? "text-[hsl(210_70%_45%)]"
                                          : "text-muted-foreground"
                                }`}
                            >
                                {evalInfo.description}
                            </span>
                            {hasMultiplePv && (
                                <span className="ml-2 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                    {pvList.length}候補
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* 候補リスト */}
                {hasPv ? (
                    <div className="space-y-3">
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
                    <div className="text-center text-muted-foreground py-6">読み筋がありません</div>
                )}
            </div>
        </BottomSheet>
    );
}
