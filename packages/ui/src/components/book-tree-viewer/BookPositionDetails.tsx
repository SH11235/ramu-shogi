import {
    type BookMove,
    deriveLastMove,
    type PositionState,
    positionToBookKey,
} from "@shogi/app-core";
import { type CSSProperties, useEffect, useState } from "react";
import { Button } from "../button";
import { ShogiBoard } from "../shogi-board";
import { HandPiecesDisplay } from "../shogi-match/components/HandPiecesDisplay";
import { cellSizeForWidth } from "../shogi-match/hooks/useMobileCellSize";
import { formatMoveSimple } from "../shogi-match/utils/kifFormat";
import { boardToGrid } from "../shogi-match/utils/positionUtils";

/** 盤の既定のマスの大きさ（`--shogi-cell-size` を指定しないときの値）。 */
const DEFAULT_CELL_SIZE = 48;
/** 320px 幅の画面でも盤がはみ出さない下限。 */
const MIN_CELL_SIZE = 22;
/** 幅を測る前の見積もりに使う、ページの左右の余白（ページ本文の px-4 × 2）。測ったあとは使わない。 */
const PAGE_PADDING_WIDTH = 32;
/** 画面の幅が分からないとき（サーバー側など）の見積もり。既定の大きさの盤が収まる幅。 */
const DEFAULT_BOARD_WIDTH = 560;
/** 持ち駒を medium / normal で 7 種類並べられる幅。これより狭ければ 1 段小さくする。 */
const MEDIUM_HAND_MIN_WIDTH = 330;
const NORMAL_HAND_MIN_WIDTH = 560;

export function BookPositionDetails({
    position,
    steps,
    bookMoves,
    ownTurn,
    resolved,
    flip,
    onFlip,
    onStep,
    onReset,
    advance,
}: {
    position: PositionState;
    steps: { position: PositionState; label: string; move?: string }[];
    bookMoves: BookMove[] | undefined;
    ownTurn: boolean;
    resolved: { moves: string[]; error?: string } | null;
    flip: boolean;
    onFlip: () => void;
    onStep: (index: number) => void;
    onReset: () => void;
    advance: (move: string) => void;
}) {
    const key = positionToBookKey(position);
    const topOwner = flip ? "sente" : "gote";
    const bottomOwner = flip ? "gote" : "sente";
    // 盤のマスは、置き場所の幅に合わせる。合わせないと、スマホの幅では既定の大きさ（48px）の
    // 盤が右へはみ出して欠ける。広い画面では既定の大きさを上限にする。
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
    // 測る前は、画面の幅からの見積もりで描く（測るまでの 1 コマ、盤がはみ出さないように）。
    const areaWidth =
        boardAreaWidth ??
        (typeof document === "undefined"
            ? DEFAULT_BOARD_WIDTH
            : document.documentElement.clientWidth - PAGE_PADDING_WIDTH);
    const cellSize = Math.min(cellSizeForWidth(areaWidth, MIN_CELL_SIZE), DEFAULT_CELL_SIZE);
    // 持ち駒は 7 種類を常に並べるので、幅が足りないときは小さい表示にする。
    const handSize =
        areaWidth < MEDIUM_HAND_MIN_WIDTH
            ? "compact"
            : areaWidth < NORMAL_HAND_MIN_WIDTH
              ? "medium"
              : "normal";
    return (
        <>
            <div
                ref={setBoardArea}
                className="flex min-w-0 flex-col gap-2"
                style={{ "--shogi-cell-size": `${cellSize}px` } as CSSProperties}
            >
                <HandPiecesDisplay
                    owner={topOwner}
                    hand={position.hands[topOwner]}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={() => {}}
                    flipBoard={flip}
                    size={handSize}
                />
                <ShogiBoard
                    grid={boardToGrid(position.board)}
                    flipBoard={flip}
                    lastMove={deriveLastMove(
                        steps.length > 1 ? steps[steps.length - 1].move : undefined,
                    )}
                />
                <HandPiecesDisplay
                    owner={bottomOwner}
                    hand={position.hands[bottomOwner]}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={() => {}}
                    flipBoard={flip}
                    size={handSize}
                />
                <Button variant="outline" aria-pressed={flip} onClick={() => onFlip()}>
                    盤を反転
                </Button>
                <p className="break-all text-xs text-muted-foreground">{key}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        disabled={steps.length <= 1}
                        onClick={() => {
                            onStep(steps.length - 2);
                        }}
                    >
                        1 手戻る
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => {
                            onReset();
                        }}
                    >
                        最初に戻る
                    </Button>
                </div>
                <nav aria-label="現在局面までの手順" className="flex flex-wrap gap-1">
                    {steps.map((step, index) => (
                        <Button
                            key={step.position.ply}
                            variant="ghost"
                            aria-current={index === steps.length - 1 ? "step" : undefined}
                            onClick={() => {
                                onStep(index);
                            }}
                        >
                            {index > 0 ? `${index}. ` : ""}
                            {step.label}
                        </Button>
                    ))}
                </nav>
                <section className="flex min-h-64 flex-col gap-2" aria-label="指し手一覧">
                    <h2 className="font-semibold">{ownTurn ? "定跡の手" : "定跡につながる手"}</h2>
                    {ownTurn && bookMoves !== undefined ? (
                        <table className="w-full text-sm">
                            <thead>
                                <tr>
                                    <th>手</th>
                                    <th>値</th>
                                    <th>深さ</th>
                                    <th>採択数</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bookMoves.map((move) => (
                                    <tr key={move.usi}>
                                        <td>
                                            <Button
                                                variant="ghost"
                                                onClick={() => advance(move.usi)}
                                            >
                                                {formatMoveSimple(
                                                    move.usi,
                                                    position.turn,
                                                    position.board,
                                                )}
                                            </Button>
                                        </td>
                                        <td>{move.value}</td>
                                        <td>{move.depth}</td>
                                        <td>{move.count}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : ownTurn ? (
                        <p>この局面は定跡にありません</p>
                    ) : !resolved ? (
                        <output>合法手を読み込み中…</output>
                    ) : resolved.error ? (
                        <p role="alert">{resolved.error}</p>
                    ) : resolved.moves.length ? (
                        resolved.moves.map((move) => (
                            <Button key={move} variant="outline" onClick={() => advance(move)}>
                                {formatMoveSimple(move, position.turn, position.board)}
                                {bookMoves?.some((entry) => entry.usi === move) && (
                                    <span className="text-xs">（定跡の手）</span>
                                )}
                            </Button>
                        ))
                    ) : (
                        <p>この先は定跡にありません</p>
                    )}
                </section>
                {!ownTurn && bookMoves && (
                    <section className="flex flex-col gap-1 text-sm" aria-label="相手側の定跡">
                        <p>
                            この局面は相手側（
                            {position.turn === "sente" ? "先手" : "後手"}
                            ）の定跡にもあります
                        </p>
                        {bookMoves
                            .filter((move) => !resolved?.moves.includes(move.usi))
                            .map((move) => (
                                <Button
                                    key={move.usi}
                                    variant="ghost"
                                    onClick={() => advance(move.usi)}
                                >
                                    {formatMoveSimple(move.usi, position.turn, position.board)}
                                </Button>
                            ))}
                    </section>
                )}
            </div>
        </>
    );
}
