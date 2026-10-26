/**
 * PVプレビューダイアログ
 *
 * 読み筋（PV）を独立した将棋盤で再生できるモーダル
 */

import type { BoardState, PositionState, Square } from "@shogi/app-core";
import { applyMoveAllowingStudyPass, boardToMatrix } from "@shogi/app-core";
import type { ReactElement } from "react";
import { useEffect, useEffectEvent, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../dialog";
import type { ShogiBoardCell } from "../../shogi-board";
import { ShogiBoard } from "../../shogi-board";
import { cellSizeForWidth } from "../hooks/useMobileCellSize";
import type { SquareNotation } from "../types";
import type { PvDisplayMove } from "../utils/kifFormat";
import { convertPvToDisplay } from "../utils/kifFormat";
import { HandPiecesDisplay } from "./HandPiecesDisplay";

interface PvPreviewDialogProps {
    /** 閉じるコールバック */
    onClose: () => void;
    /** PV（USI形式の指し手配列） */
    pv: string[];
    /** 開始局面 */
    startPosition: PositionState;
    /** 手数（何手目のPVか） */
    ply: number;
    /** 評価値（センチポーン） */
    evalCp?: number;
    /** 詰み手数 */
    evalMate?: number;
    /** マス内座標表示形式 */
    squareNotation?: SquareNotation;
    /** 盤外ラベル表示 */
    showBoardLabels?: boolean;
    /** 読み上げ用の説明（画面には出さない）。渡したときだけ付け、ダイアログに関連付ける。 */
    description?: string;
    /**
     * 読み筋の最初の手の表記の差し替え（直前の手と同じマスへの手を「同」と書く、など、
     * 開いた画面の表記に揃えるため）。省略時は、これまでどおりの表記。
     */
    firstMoveLabel?: string;
}

/** PC の広いダイアログでも、盤をこれ以上大きくしない（読み筋の一覧まで 1 画面に収める）。 */
const MAX_PREVIEW_CELL_SIZE = 40;
/**
 * マスの下限。盤面の本体（28px）より小さくまで許す。ダイアログは余白の分だけ盤に使える幅が狭く、
 * 320px 幅の端末では 28px だと盤がはみ出す。
 */
const MIN_PREVIEW_CELL_SIZE = 22;
/** 画面の幅のうち、盤に使えない分。ダイアログの外側の余白 24 + 枠 2 + 内側の余白 24（スマホ）。 */
const DIALOG_CHROME_WIDTH = 50;
/** 持ち駒をスマホ用の大きさ（medium）で 1 行に出せる幅。これより狭ければ compact にする。 */
const MEDIUM_HAND_MIN_WIDTH = 330;
/**
 * 盤のほかに縦に要る高さ（題・持ち駒 2 段・送りのボタン・読み筋の 1 行・余白）と、ダイアログの外の余白。
 * 背の低いスマホ（375x553 など）では、幅でなく高さで盤の大きさが決まる。
 */
const DIALOG_CHROME_HEIGHT = 250;
const DIALOG_OUTER_MARGIN = 24;
/** 盤の高さはマスの約 10.4 倍（9 マスと筋・段の見出し・枠）。 */
const BOARD_HEIGHT_PER_CELL = 10.4;

function boardToGrid(board: BoardState): ShogiBoardCell[][] {
    const matrix = boardToMatrix(board);
    return matrix.map((row) =>
        row.map((cell) => ({
            id: cell.square,
            piece: cell.piece
                ? {
                      owner: cell.piece.owner,
                      type: cell.piece.type,
                      promoted: cell.piece.promoted,
                  }
                : null,
        })),
    );
}

export function PvPreviewDialog({
    onClose,
    pv,
    startPosition,
    ply,
    evalCp,
    evalMate,
    squareNotation = "none",
    showBoardLabels = false,
    description,
    firstMoveLabel,
}: PvPreviewDialogProps): ReactElement {
    // 盤のマスの大きさは、ダイアログの中身の幅に合わせる。ダイアログは body 直下へ出るので、
    // 開いた画面の `--shogi-cell-size` は届かない。合わせないと、狭い画面で盤が既定の大きさの
    // まま押しつぶされ、マスが縦長になって駒が欠ける。
    // ダイアログの中身は開いたあとに現れる。ref だと現れても effect が走り直さないので、
    // 要素を state で受けて、現れたときに幅を測り始める。
    const [boardArea, setBoardArea] = useState<HTMLDivElement | null>(null);
    const [boardAreaWidth, setBoardAreaWidth] = useState<number | null>(null);
    useEffect(() => {
        if (!boardArea) return;
        const update = () => setBoardAreaWidth(boardArea.clientWidth);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(boardArea);
        return () => observer.disconnect();
    }, [boardArea]);
    // 測る前は、画面の幅からの見積もりで描く。
    const areaWidth =
        boardAreaWidth ??
        (typeof document === "undefined"
            ? 0
            : document.documentElement.clientWidth - DIALOG_CHROME_WIDTH);
    const [viewportHeight, setViewportHeight] = useState(() =>
        typeof window === "undefined" ? 0 : window.innerHeight,
    );
    useEffect(() => {
        const update = () => setViewportHeight(window.innerHeight);
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);
    const cellSizeForHeight = Math.floor(
        (viewportHeight - DIALOG_OUTER_MARGIN - DIALOG_CHROME_HEIGHT) / BOARD_HEIGHT_PER_CELL,
    );
    const cellSize = Math.max(
        MIN_PREVIEW_CELL_SIZE,
        Math.min(
            cellSizeForWidth(areaWidth, MIN_PREVIEW_CELL_SIZE),
            cellSizeForHeight,
            MAX_PREVIEW_CELL_SIZE,
        ),
    );
    // 持ち駒は 7 種すべてを 1 行に出す。PC 用の大きさ（normal）は約 540px、スマホ用（medium）でも
    // 約 320px になるので、幅が足りない端末（360px 幅など）ではさらに小さい表示にする。
    const handSize = areaWidth < MEDIUM_HAND_MIN_WIDTH ? "compact" : "medium";
    // 持っていない駒は盤面の画面と同じく出さない。持ち駒が無い段も同じ高さを取り、手を送るたびに盤が上下に動かないようにする。
    // 下限の 34px は駒がある段の高さ（compact でも、駒の 24px に余白と枠が付いて 34px になる）。
    const handZoneClass = "w-full min-h-[max(34px,calc(var(--shogi-cell-size)*0.8+15px))]";

    // 現在のプレビュー位置（0 = 開始局面、1 = PVの1手目後、...）
    const [previewIndex, setPreviewIndex] = useState(0);
    const [pvList, setPvList] = useState<HTMLDivElement | null>(null);
    // biome-ignore lint/correctness/useExhaustiveDependencies: 見ている手が変わるたびに送り直す
    useEffect(() => {
        if (!pvList) return;
        const current = pvList.querySelector<HTMLElement>('[aria-current="true"]');
        if (current) current.scrollIntoView({ block: "nearest", inline: "nearest" });
        else pvList.scrollLeft = 0;
    }, [pvList, previewIndex]);

    // 各ステップの局面を事前計算（有効な手のみ）
    const { positions, validPv } = (() => {
        const positionResult: PositionState[] = [startPosition];
        const validMoves: string[] = [];
        let currentPosition = startPosition;

        for (const move of pv) {
            const moveResult = applyMoveAllowingStudyPass(currentPosition, move, {
                validateTurn: false,
            });
            if (!moveResult.ok) {
                // 無効な手以降は無視（エンジンPVの既知の動作）
                break;
            }
            validMoves.push(move);
            positionResult.push(moveResult.next);
            currentPosition = moveResult.next;
        }

        return { positions: positionResult, validPv: validMoves };
    })();

    // 有効なPVを表示用に変換
    const pvDisplay: PvDisplayMove[] = convertPvToDisplay(validPv, startPosition).map(
        (move, index) =>
            index === 0 && firstMoveLabel !== undefined
                ? { ...move, displayText: firstMoveLabel }
                : move,
    );

    // 最終手情報
    const lastMove = (() => {
        if (previewIndex === 0) return undefined;
        const move = validPv[previewIndex - 1];
        // パスには移動元も移動先も無い（`pass` は 4 文字なので、移動として読まないよう先に見る）。
        if (!move || move.toLowerCase() === "pass") return undefined;

        // 打ち駒の場合
        if (move.includes("*")) {
            const to = move.slice(-2) as Square;
            return { from: undefined, to };
        }

        // 移動の場合
        const from = move.slice(0, 2) as Square;
        const to = move.slice(2, 4) as Square;
        return { from, to };
    })();

    // 現在の局面
    const currentPosition = positions[previewIndex] ?? startPosition;

    // 盤面グリッド
    const grid = boardToGrid(currentPosition.board);

    // キーボード操作
    const handleKeyDown = useEffectEvent((e: KeyboardEvent) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            setPreviewIndex((prev) => Math.max(0, prev - 1));
        } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            setPreviewIndex((prev) => Math.min(positions.length - 1, prev + 1));
        } else if (e.key === "Home") {
            e.preventDefault();
            setPreviewIndex(0);
        } else if (e.key === "End") {
            e.preventDefault();
            setPreviewIndex(positions.length - 1);
        } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        }
    });

    // キーボードイベントをリッスン（マウント中は常にアクティブ）
    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    // positions.length が変わったときに previewIndex が範囲外にならないようクランプ
    // （開いたままPVが差し替わった場合への対応）
    useEffect(() => {
        if (positions.length > 0) {
            setPreviewIndex((prev) => Math.min(prev, positions.length - 1));
        }
    }, [positions.length]);

    // 評価値の表示フォーマット
    const evalText = (() => {
        if (evalMate !== undefined && evalMate !== null) {
            return evalMate > 0 ? `詰み${evalMate}手` : `被詰み${Math.abs(evalMate)}手`;
        }
        if (evalCp !== undefined && evalCp !== null) {
            const sign = evalCp >= 0 ? "+" : "";
            return `${sign}${evalCp}`;
        }
        return null;
    })();

    return (
        <Dialog defaultOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent
                // 盤と送りのボタン・読み筋を 1 画面に収めるため、背の低い画面でも高さをほぼ使う。
                className="max-h-[calc(100dvh-24px)] max-w-[500px] p-3 sm:p-6"
                // 説明を渡したときだけ関連付ける（渡さない呼び出しは、これまでどおり）。
                hasDescription={description !== undefined}
            >
                <DialogHeader className="flex min-h-8 flex-row items-center justify-between pr-8">
                    <DialogTitle className="text-sm font-medium">
                        {ply === 0 ? "開始局面からの読み筋" : `${ply}手目の読み筋`}
                        <span className="text-muted-foreground font-normal">
                            （{validPv.length}手）
                        </span>
                        {evalText && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                [{evalText}]
                            </span>
                        )}
                    </DialogTitle>
                    {description !== undefined && (
                        <DialogDescription className="sr-only">{description}</DialogDescription>
                    )}
                </DialogHeader>
                {/* 右上の閉じるボタン */}
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute right-3 top-3 p-1.5 rounded hover:bg-muted cursor-pointer text-muted-foreground hover:text-foreground"
                    aria-label="閉じる"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>

                <div className="flex flex-col gap-1.5">
                    {/* 将棋盤と持ち駒 */}
                    <div
                        ref={setBoardArea}
                        className="flex w-full flex-col items-center gap-1"
                        style={{ "--shogi-cell-size": `${cellSize}px` } as React.CSSProperties}
                    >
                        {/* 後手の持ち駒 */}
                        <div className={handZoneClass}>
                            <HandPiecesDisplay
                                owner="gote"
                                hand={currentPosition.hands.gote}
                                selectedPiece={null}
                                isActive={false}
                                onHandSelect={() => {}}
                                flipBoard={false}
                                size={handSize}
                                hideEmptyPieces
                            />
                        </div>

                        {/* 将棋盤 */}
                        <ShogiBoard
                            grid={grid}
                            selectedSquare={null}
                            lastMove={lastMove}
                            promotionSquare={null}
                            onSelect={() => {}}
                            flipBoard={false}
                            squareNotation={squareNotation}
                            showBoardLabels={showBoardLabels}
                        />

                        {/* 先手の持ち駒 */}
                        <div className={handZoneClass}>
                            <HandPiecesDisplay
                                owner="sente"
                                hand={currentPosition.hands.sente}
                                selectedPiece={null}
                                isActive={false}
                                onHandSelect={() => {}}
                                flipBoard={false}
                                size={handSize}
                                hideEmptyPieces
                            />
                        </div>
                    </div>

                    {/* ナビゲーション: 手数表示とボタンを1行に */}
                    <div className="flex items-center justify-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => setPreviewIndex(0)}
                            disabled={previewIndex === 0}
                            className="min-w-10 px-3 py-2.5 text-sm bg-muted hover:bg-muted/80 rounded border border-border disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            |&lt;
                        </button>
                        <button
                            type="button"
                            onClick={() => setPreviewIndex((prev) => Math.max(0, prev - 1))}
                            disabled={previewIndex === 0}
                            className="min-w-10 px-3 py-2.5 text-sm bg-muted hover:bg-muted/80 rounded border border-border disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            &lt;
                        </button>
                        <span className="text-xs text-muted-foreground min-w-[80px] text-center">
                            {previewIndex === 0
                                ? "開始局面"
                                : `${previewIndex}/${validPv.length}手`}
                        </span>
                        <button
                            type="button"
                            onClick={() =>
                                setPreviewIndex((prev) => Math.min(positions.length - 1, prev + 1))
                            }
                            disabled={previewIndex >= positions.length - 1}
                            className="min-w-10 px-3 py-2.5 text-sm bg-muted hover:bg-muted/80 rounded border border-border disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            &gt;
                        </button>
                        <button
                            type="button"
                            onClick={() => setPreviewIndex(positions.length - 1)}
                            disabled={previewIndex >= positions.length - 1}
                            className="min-w-10 px-3 py-2.5 text-sm bg-muted hover:bg-muted/80 rounded border border-border disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            &gt;|
                        </button>
                    </div>

                    {/* 読み筋リスト。長い読み筋でも縦を取らないよう 1 行にし、見ている手を見える位置へ送る。 */}
                    <div
                        ref={setPvList}
                        className="flex gap-0.5 overflow-x-auto overscroll-contain whitespace-nowrap scrollbar-hide text-xs font-mono tabular-nums [scrollbar-width:none] [-ms-overflow-style:none]"
                    >
                        {pvDisplay.map((move, index) => {
                            const moveNumber = index + 1;
                            return (
                                <button
                                    key={move.usiMove}
                                    type="button"
                                    aria-current={moveNumber === previewIndex ? "true" : undefined}
                                    onClick={() => setPreviewIndex(moveNumber)}
                                    className={`shrink-0 px-1 py-0.5 rounded cursor-pointer ${
                                        index + 1 === previewIndex ? "bg-accent" : "hover:bg-muted"
                                    } ${
                                        move.turn === "sente" ? "text-wafuu-shu" : "text-wafuu-ai"
                                    }`}
                                >
                                    {move.displayText}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
