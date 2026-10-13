/**
 * 対局中のヒント。いまの局面の候補手を出すだけの欄。
 *
 * 評価関数は選ばせない（準備の済んでいるものを自動で使う）。結果はその局面を見ている間だけ出し、
 * 手が進んだら消える。棋譜全体の解析は研究ノートで行う。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { Button } from "../../button";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useCurrentPositionAiHints } from "../hooks/useCurrentPositionAiHints";
import { useShogiMatchConfig } from "../ShogiMatchContext";

const scoreClass = (tone: "sente" | "gote" | "neutral"): string =>
    tone === "sente"
        ? "text-wafuu-shu"
        : tone === "gote"
          ? "text-wafuu-ai"
          : "text-muted-foreground";

interface PlayHintCardProps {
    /** 枠で囲まず、1 行に詰めて出す（スマホの盤の下） */
    compact?: boolean;
    className?: string;
}

export function PlayHintCard({ compact = false, className }: PlayHintCardProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const { navigationState } = useNavigation();
    const { position, sides, gameMode } = useMatchState();
    const { moves, isAnalyzing } = useCurrentPositionAiHints();

    const isMyTurn = gameMode === "playing" && sides[position.turn].role === "human";
    // ヒントを求めた局面を見ている間だけ、結果を出す（対局エンジンの読み筋を勝手に出さない）。
    const isForThisPosition = play?.hintPly === navigationState.currentPly;
    const shownMoves = isForThisPosition ? moves : [];
    const isThinking = isForThisPosition && isAnalyzing && shownMoves.length === 0;

    const idleText =
        gameMode === "paused"
            ? "一時停止中は使えません。"
            : isMyTurn
              ? "いまの局面の候補手を 3 つまで出します。"
              : "あなたの手番で使えます。";

    return (
        <section
            aria-label="ヒント"
            className={cn(
                "flex flex-col gap-2",
                !compact && "rounded-xl border border-border bg-card p-3 shadow-card",
                className,
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                    ヒント
                    {play && play.hintCount > 0 && (
                        <span className="pl-2 text-xs font-normal text-muted-foreground">
                            この対局で {play.hintCount} 回
                        </span>
                    )}
                </h2>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => play?.requestHint()}
                    disabled={!isMyTurn || isAnalyzing}
                >
                    {isThinking ? "考え中…" : shownMoves.length > 0 ? "もう一度" : "ヒントを見る"}
                </Button>
            </div>
            {shownMoves.length > 0 ? (
                <ol className="flex flex-col gap-1" aria-live="polite">
                    {shownMoves.map((move, index) => (
                        <li
                            key={move.usi}
                            className={cn(
                                "flex items-baseline gap-2 rounded-md px-2 py-1 text-sm",
                                index === 0 && "bg-wafuu-kin/15",
                            )}
                        >
                            <span className="w-4 shrink-0 text-xs text-muted-foreground">
                                {index + 1}
                            </span>
                            <span
                                className={cn(
                                    "flex-1 text-foreground",
                                    index === 0 && "font-semibold",
                                )}
                            >
                                {move.displayText}
                            </span>
                            <span
                                className={cn(
                                    "font-mono text-xs tabular-nums",
                                    scoreClass(move.scoreTone),
                                )}
                            >
                                {move.scoreText}
                            </span>
                        </li>
                    ))}
                </ol>
            ) : (
                <p className="text-xs leading-relaxed text-muted-foreground" aria-live="polite">
                    {isThinking ? "候補手を調べています…" : idleText}
                </p>
            )}
        </section>
    );
}
