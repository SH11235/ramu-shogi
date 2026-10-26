import {
    type BookMove,
    deriveLastMove,
    type PositionState,
    positionToBookKey,
} from "@shogi/app-core";
import { Button } from "../button";
import { DEFAULT_SHOGI_CELL_SIZE } from "../shogi-board";
import { formatMoveSimple } from "../shogi-match/utils/kifFormat";
import { StaticBoardView } from "../static-board-view";

/**
 * 盤のマスは置き場所の幅に合わせる（スマホの幅で既定の大きさの盤が右へはみ出して欠けないように）。
 * 下限は 320px 幅の画面でもはみ出さない大きさ、上限は既定の大きさ。測る前の見積もりでは、
 * ページ本文の左右の余白（px-4 × 2）を画面の幅から引く。
 */
const BOARD_FIT = { minCellSize: 22, maxCellSize: DEFAULT_SHOGI_CELL_SIZE, viewportInset: 32 };

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
    return (
        <>
            <div className="flex min-w-0 flex-col gap-2">
                <StaticBoardView
                    position={position}
                    flipBoard={flip}
                    lastMove={deriveLastMove(
                        steps.length > 1 ? steps[steps.length - 1].move : undefined,
                    )}
                    handSize="auto"
                    fit={BOARD_FIT}
                    className="gap-2"
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
