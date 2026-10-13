import {
    type BookMove,
    deriveLastMove,
    type PositionState,
    positionToBookKey,
} from "@shogi/app-core";
import { Button } from "../button";
import { ShogiBoard } from "../shogi-board";
import { HandPiecesDisplay } from "../shogi-match/components/HandPiecesDisplay";
import { formatMoveSimple } from "../shogi-match/utils/kifFormat";
import { boardToGrid } from "../shogi-match/utils/positionUtils";

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
    return (
        <>
            <div className="flex min-w-0 flex-col gap-2">
                <HandPiecesDisplay
                    owner={topOwner}
                    hand={position.hands[topOwner]}
                    selectedPiece={null}
                    isActive={false}
                    onHandSelect={() => {}}
                    flipBoard={flip}
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
