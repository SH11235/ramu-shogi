/**
 * 手の詳細ウィンドウ（ドラッグ・リサイズ可能）
 *
 * 非モーダル：背景操作をブロックしない
 * ヘッダー部分をドラッグして移動可能
 * 四隅＋四辺からリサイズ可能
 */

import type {
    KifuTree,
    NnueMeta,
    NnueSelection,
    PositionState,
    PresetConfig,
} from "@shogi/app-core";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import {
    comparePvWithMainLine,
    findExistingBranchForPv,
    type PvMainLineComparison,
} from "../utils/branchTreeUtils";
import type { KifMove, PvDisplayMove, PvEvalInfo } from "../utils/kifFormat";
import { convertPvToDisplay, formatEval, getEvalTooltipInfo } from "../utils/kifFormat";
import {
    buildNnueOptions,
    parseNnueSelectionValue,
    toNnueSelectionValue,
    toOptionValue,
} from "../utils/nnueSelectionUtils";

interface MoveDetailWindowProps {
    /** 選択された手 */
    move: KifMove;
    /** 手が指された後の局面 */
    position: PositionState;
    /** PVを分岐として追加するコールバック */
    onAddBranch?: (ply: number, pv: string[]) => void;
    /** PVを盤面で確認するコールバック */
    onPreview?: (ply: number, pv: string[], evalCp?: number, evalMate?: number) => void;
    /** 指定手数の局面を解析するコールバック */
    onAnalyze?: (ply: number) => void;
    /** 解析中かどうか */
    isAnalyzing?: boolean;
    /** 現在解析中の手数 */
    analyzingPly?: number;
    /** 解析エラー（発生した手数とメッセージ） */
    analysisError?: { ply: number; message: string };
    /** 分析用 NNUE 選択 */
    analysisNnueSelection?: NnueSelection;
    onAnalysisNnueSelectionChange?: (selection: NnueSelection) => void;
    /** ダウンロード済み NNUE 一覧 */
    nnueList?: NnueMeta[];
    /** NNUE 一覧読み込み中フラグ */
    isNnueListLoading?: boolean;
    /** プリセット一覧（未ダウンロードも含む） */
    presets?: PresetConfig[];
    /** 棋譜ツリー（分岐追加の重複チェック用） */
    kifuTree?: KifuTree;
    /** ウィンドウを閉じるコールバック */
    onClose: () => void;
    /** 現在位置がメインライン上にあるか */
    isOnMainLine?: boolean;
}

interface Position {
    x: number;
    y: number;
}

interface Size {
    width: number;
    height: number;
}

/** ドラッグモード: none=なし, move=移動, resize-XX=リサイズ（隅・辺） */
type DragMode =
    | "none"
    | "move"
    | "resize-n"
    | "resize-s"
    | "resize-e"
    | "resize-w"
    | "resize-ne"
    | "resize-nw"
    | "resize-se"
    | "resize-sw";

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 400;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;
const EDGE_HANDLE_SIZE = 6;

/**
 * 単一のPV候補を表示するコンポーネント
 */
function PvCandidateItem({
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
                bg-[hsl(var(--wafuu-washi)/0.3)] dark:bg-[hsl(var(--muted)/0.3)]
            "
        >
            {/* ヘッダー: 候補番号 + 評価値 */}
            <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-medium bg-muted px-1.5 py-0.5 rounded">
                    候補{pv.multipv}
                </span>
                <span
                    className={`font-medium text-[13px] ${
                        evalInfo.advantage === "sente"
                            ? "text-wafuu-shu"
                            : evalInfo.advantage === "gote"
                              ? "text-[hsl(210_70%_45%)]"
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
                <div className="flex flex-wrap gap-1 text-[12px] font-mono mb-2">
                    {pvDisplay.map((m, index) => (
                        <span
                            key={m.usiMove}
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

            {/* アクションボタン */}
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
                                                bg-[hsl(var(--wafuu-kin)/0.1)] hover:bg-[hsl(var(--wafuu-kin)/0.2)]
                                                text-[hsl(var(--wafuu-sumi))]
                                                rounded border border-[hsl(var(--wafuu-kin)/0.3)]
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

/**
 * 手の詳細ウィンドウ（ドラッグ・リサイズ可能）
 */
export function MoveDetailWindow({
    move,
    position,
    onAddBranch,
    onPreview,
    onAnalyze,
    isAnalyzing,
    analyzingPly,
    analysisError,
    analysisNnueSelection,
    onAnalysisNnueSelectionChange,
    nnueList,
    isNnueListLoading,
    presets,
    kifuTree,
    onClose,
    isOnMainLine = true,
}: MoveDetailWindowProps): ReactElement {
    // 初期位置を画面中央やや右上に設定
    const [windowPosition, setWindowPosition] = useState<Position>(() => ({
        x:
            typeof window !== "undefined"
                ? Math.max(50, window.innerWidth - DEFAULT_WIDTH - 100)
                : 100,
        y: typeof window !== "undefined" ? 100 : 100,
    }));
    const [size, setSize] = useState<Size>({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

    const dragMode = useRef<DragMode>("none");
    const dragStart = useRef<Position>({ x: 0, y: 0 });
    const initialPosition = useRef<Position>({ x: 0, y: 0 });
    const initialSize = useRef<Size>({ width: 0, height: 0 });

    // ドラッグ開始（移動）
    const handleMoveStart = (e: React.MouseEvent) => {
        e.preventDefault();
        dragMode.current = "move";
        dragStart.current = { x: e.clientX, y: e.clientY };
        initialPosition.current = { ...windowPosition };
    };

    // リサイズ開始（共通）
    const createResizeHandler = (mode: DragMode) => (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragMode.current = mode;
        dragStart.current = { x: e.clientX, y: e.clientY };
        initialPosition.current = { ...windowPosition };
        initialSize.current = { ...size };
    };

    // Escキーでウィンドウを閉じる
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, [onClose]);

    // マウス移動・終了のグローバルハンドラ
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (dragMode.current === "none") return;

            const deltaX = e.clientX - dragStart.current.x;
            const deltaY = e.clientY - dragStart.current.y;

            if (dragMode.current === "move") {
                const newX = initialPosition.current.x + deltaX;
                const newY = initialPosition.current.y + deltaY;
                const maxX = window.innerWidth - size.width;
                const maxY = window.innerHeight - size.height;
                setWindowPosition({
                    x: Math.max(0, Math.min(newX, maxX)),
                    y: Math.max(0, Math.min(newY, maxY)),
                });
            } else if (dragMode.current === "resize-e") {
                const newWidth = initialSize.current.width + deltaX;
                const maxWidth = window.innerWidth - windowPosition.x;
                setSize((prev) => ({
                    ...prev,
                    width: Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth)),
                }));
            } else if (dragMode.current === "resize-w") {
                const newX = initialPosition.current.x + deltaX;
                const maxX = initialPosition.current.x + initialSize.current.width - MIN_WIDTH;
                const clampedX = Math.max(0, Math.min(newX, maxX));
                const clampedWidth =
                    initialPosition.current.x + initialSize.current.width - clampedX;
                setSize((prev) => ({ ...prev, width: Math.max(MIN_WIDTH, clampedWidth) }));
                setWindowPosition((prev) => ({ ...prev, x: clampedX }));
            } else if (dragMode.current === "resize-s") {
                const newHeight = initialSize.current.height + deltaY;
                const maxHeight = window.innerHeight - windowPosition.y;
                setSize((prev) => ({
                    ...prev,
                    height: Math.max(MIN_HEIGHT, Math.min(newHeight, maxHeight)),
                }));
            } else if (dragMode.current === "resize-n") {
                const newY = initialPosition.current.y + deltaY;
                const maxY = initialPosition.current.y + initialSize.current.height - MIN_HEIGHT;
                const clampedY = Math.max(0, Math.min(newY, maxY));
                const clampedHeight =
                    initialPosition.current.y + initialSize.current.height - clampedY;
                setSize((prev) => ({ ...prev, height: Math.max(MIN_HEIGHT, clampedHeight) }));
                setWindowPosition((prev) => ({ ...prev, y: clampedY }));
            } else if (dragMode.current === "resize-se") {
                const newWidth = initialSize.current.width + deltaX;
                const newHeight = initialSize.current.height + deltaY;
                const maxWidth = window.innerWidth - windowPosition.x;
                const maxHeight = window.innerHeight - windowPosition.y;
                setSize({
                    width: Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth)),
                    height: Math.max(MIN_HEIGHT, Math.min(newHeight, maxHeight)),
                });
            } else if (dragMode.current === "resize-ne") {
                const newWidth = initialSize.current.width + deltaX;
                const newY = initialPosition.current.y + deltaY;
                const maxWidth = window.innerWidth - windowPosition.x;
                const clampedWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth));
                const maxY = initialPosition.current.y + initialSize.current.height - MIN_HEIGHT;
                const clampedY = Math.max(0, Math.min(newY, maxY));
                const clampedHeight =
                    initialPosition.current.y + initialSize.current.height - clampedY;
                setSize({ width: clampedWidth, height: Math.max(MIN_HEIGHT, clampedHeight) });
                setWindowPosition((prev) => ({ ...prev, y: clampedY }));
            } else if (dragMode.current === "resize-sw") {
                const newX = initialPosition.current.x + deltaX;
                const newHeight = initialSize.current.height + deltaY;
                const maxX = initialPosition.current.x + initialSize.current.width - MIN_WIDTH;
                const clampedX = Math.max(0, Math.min(newX, maxX));
                const clampedWidth =
                    initialPosition.current.x + initialSize.current.width - clampedX;
                const maxHeight = window.innerHeight - windowPosition.y;
                setSize({
                    width: Math.max(MIN_WIDTH, clampedWidth),
                    height: Math.max(MIN_HEIGHT, Math.min(newHeight, maxHeight)),
                });
                setWindowPosition((prev) => ({ ...prev, x: clampedX }));
            } else if (dragMode.current === "resize-nw") {
                const newX = initialPosition.current.x + deltaX;
                const newY = initialPosition.current.y + deltaY;
                const maxX = initialPosition.current.x + initialSize.current.width - MIN_WIDTH;
                const clampedX = Math.max(0, Math.min(newX, maxX));
                const clampedWidth =
                    initialPosition.current.x + initialSize.current.width - clampedX;
                const maxY = initialPosition.current.y + initialSize.current.height - MIN_HEIGHT;
                const clampedY = Math.max(0, Math.min(newY, maxY));
                const clampedHeight =
                    initialPosition.current.y + initialSize.current.height - clampedY;
                setSize({
                    width: Math.max(MIN_WIDTH, clampedWidth),
                    height: Math.max(MIN_HEIGHT, clampedHeight),
                });
                setWindowPosition({ x: clampedX, y: clampedY });
            }
        };

        const handleMouseUp = () => {
            dragMode.current = "none";
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [size.width, size.height, windowPosition.x, windowPosition.y]);

    // 複数PVがある場合はリストで表示、なければ従来の単一PVを使用
    const pvList: PvEvalInfo[] = (() => {
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
    const bestPv = pvList[0];
    const evalInfo = getEvalTooltipInfo(
        bestPv?.evalCp ?? move.evalCp,
        bestPv?.evalMate ?? move.evalMate,
        move.ply,
        bestPv?.depth ?? move.depth,
    );

    // この手数が解析中かどうか
    const isThisPlyAnalyzing = isAnalyzing && analyzingPly === move.ply;

    const hasPv = pvList.length > 0;
    const hasMultiplePv = pvList.length > 1;

    // NNUE選択肢を構築（プリセット + カスタムNNUE）
    const nnueOptions = buildNnueOptions({ presets, nnueList, isNnueListLoading });

    // 現在の選択値を計算
    const selectedValue = toNnueSelectionValue(analysisNnueSelection);

    const showNnueSelector = analysisNnueSelection !== undefined && !!onAnalysisNnueSelectionChange;

    return (
        <div
            className="fixed flex flex-col overflow-hidden bg-card border border-border rounded-xl shadow-2xl z-[1000]"
            style={{
                left: windowPosition.x,
                top: windowPosition.y,
                width: size.width,
                height: size.height,
            }}
        >
            {/* ヘッダー（ドラッグハンドル） */}
            <div
                className="flex justify-between items-center px-3 py-2 bg-muted border-b border-border cursor-move select-none"
                onMouseDown={handleMoveStart}
                role="toolbar"
                aria-label="ウィンドウ移動ハンドル"
            >
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">詳細</span>
                    <span className="text-[11px] text-muted-foreground">{move.ply}手目</span>
                    <span className="text-[13px] font-medium">{move.displayText}</span>
                </div>
                <button
                    type="button"
                    className="bg-transparent border-none cursor-pointer px-2 py-1 rounded text-base leading-none text-muted-foreground hover:bg-accent"
                    onClick={onClose}
                    aria-label="閉じる"
                >
                    ✕
                </button>
            </div>

            {/* コンテンツ */}
            <div className="flex-1 overflow-auto p-3">
                {/* 評価値サマリー */}
                <div className="flex items-center gap-2 mb-3 p-2 bg-[hsl(var(--wafuu-washi))] dark:bg-[hsl(var(--muted)/0.5)] rounded-lg">
                    <span
                        className={`font-medium text-[14px] ${
                            evalInfo.advantage === "sente"
                                ? "text-wafuu-shu"
                                : evalInfo.advantage === "gote"
                                  ? "text-[hsl(210_70%_45%)]"
                                  : ""
                        }`}
                    >
                        {evalInfo.description}
                    </span>
                    {hasMultiplePv && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {pvList.length}候補
                        </span>
                    )}
                    <div className="text-muted-foreground text-[10px] ml-auto space-x-1.5">
                        {evalInfo.detail && <span>{evalInfo.detail}</span>}
                        {evalInfo.depthText && <span>{evalInfo.depthText}</span>}
                    </div>
                </div>

                {/* 複数PV候補リスト */}
                {hasPv && (
                    <div className="space-y-2">
                        {pvList.map((pv) => (
                            <PvCandidateItem
                                key={pv.multipv}
                                pv={pv}
                                position={position}
                                ply={move.ply}
                                onAddBranch={onAddBranch}
                                onPreview={onPreview}
                                isOnMainLine={isOnMainLine}
                                kifuTree={kifuTree}
                            />
                        ))}
                    </div>
                )}

                {/* 解析ボタン */}
                {onAnalyze && (
                    <div
                        className={
                            hasPv ? "pt-2 border-t border-border mt-2 space-y-2" : "space-y-2"
                        }
                    >
                        {!hasPv && (
                            <div className="text-[11px] text-muted-foreground mb-2">
                                読み筋がありません
                            </div>
                        )}
                        {showNnueSelector && (
                            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                                <span>分析に使うAI</span>
                                <select
                                    value={selectedValue}
                                    onChange={(e) =>
                                        onAnalysisNnueSelectionChange?.(
                                            parseNnueSelectionValue(e.target.value),
                                        )
                                    }
                                    className="w-full px-2 py-1 text-xs rounded border border-border bg-background"
                                >
                                    <option value="material">簡易AI（駒得）</option>
                                    {nnueOptions.map((opt) => (
                                        <option key={toOptionValue(opt)} value={toOptionValue(opt)}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <button
                            type="button"
                            onClick={() => onAnalyze(move.ply)}
                            disabled={isThisPlyAnalyzing}
                            className={`
                                w-full px-3 py-2 text-[12px]
                                disabled:opacity-50 disabled:cursor-not-allowed
                                rounded border border-border
                                transition-colors cursor-pointer
                                ${
                                    hasPv
                                        ? "bg-muted hover:bg-muted/80 text-foreground"
                                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                                }
                            `}
                        >
                            {isThisPlyAnalyzing ? (
                                <span>解析中...</span>
                            ) : (
                                <>
                                    <span className="mr-1">{hasPv ? "🔄" : "🔍"}</span>
                                    {hasPv ? "再解析する" : "この局面を解析する"}
                                </>
                            )}
                        </button>
                        {/* 解析エラー表示 */}
                        {analysisError && analysisError.ply === move.ply && (
                            <div className="mt-2 px-2 py-1.5 rounded bg-destructive/10 border border-destructive/30 text-destructive text-[11px]">
                                {analysisError.message}
                            </div>
                        )}
                    </div>
                )}

                {/* 読み筋もなく解析機能もない場合のメッセージ */}
                {!hasPv && !onAnalyze && (
                    <div className="text-[12px] text-muted-foreground text-center py-4">
                        この手には詳細情報がありません
                    </div>
                )}
            </div>

            {/* リサイズハンドル - マウス操作専用のためアクセシビリティツリーから除外 */}
            <div
                className="absolute top-0 left-3 right-3 cursor-ns-resize"
                style={{ height: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-n")}
                aria-hidden="true"
            />
            <div
                className="absolute bottom-0 left-3 right-3 cursor-ns-resize"
                style={{ height: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-s")}
                aria-hidden="true"
            />
            <div
                className="absolute left-0 top-3 bottom-3 cursor-ew-resize"
                style={{ width: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-w")}
                aria-hidden="true"
            />
            <div
                className="absolute right-0 top-3 bottom-3 cursor-ew-resize"
                style={{ width: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-e")}
                aria-hidden="true"
            />
            <div
                className="absolute left-0 top-0 w-3 h-3 cursor-nwse-resize"
                onMouseDown={createResizeHandler("resize-nw")}
                aria-hidden="true"
            >
                <div className="absolute left-1 top-1 w-2 h-2 border-l-2 border-t-2 border-muted-foreground opacity-50" />
            </div>
            <div
                className="absolute right-0 top-0 w-3 h-3 cursor-nesw-resize"
                onMouseDown={createResizeHandler("resize-ne")}
                aria-hidden="true"
            >
                <div className="absolute right-1 top-1 w-2 h-2 border-r-2 border-t-2 border-muted-foreground opacity-50" />
            </div>
            <div
                className="absolute left-0 bottom-0 w-3 h-3 cursor-nesw-resize"
                onMouseDown={createResizeHandler("resize-sw")}
                aria-hidden="true"
            >
                <div className="absolute left-1 bottom-1 w-2 h-2 border-l-2 border-b-2 border-muted-foreground opacity-50" />
            </div>
            <div
                className="absolute right-0 bottom-0 w-3 h-3 cursor-nwse-resize"
                onMouseDown={createResizeHandler("resize-se")}
                aria-hidden="true"
            >
                <div className="absolute right-1 bottom-1 w-2 h-2 border-r-2 border-b-2 border-muted-foreground opacity-50" />
            </div>
        </div>
    );
}
