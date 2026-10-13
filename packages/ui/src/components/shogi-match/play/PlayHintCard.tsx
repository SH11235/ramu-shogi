/**
 * 対局中のヒント。いまの局面の候補手を出すだけの欄。
 *
 * 評価関数は選ばせない（準備の済んでいるものを自動で使う）。結果はその局面を見ている間だけ出し、
 * 手が進んだら消える。いちばんの候補は盤にも示す（`usePlayHintMove`）。棋譜全体の解析は研究ノートで行う。
 */

import type { Player } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../../button";
import type { AiHintMove } from "../components/AiHintPanel";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useCurrentPositionAiHints } from "../hooks/useCurrentPositionAiHints";
import { useShogiMatchConfig } from "../ShogiMatchContext";

/** ヒントを求めた局面を見ている間だけ、その結果を返す。 */
function useShownHints(): { moves: AiHintMove[]; isThinking: boolean; isAnalyzing: boolean } {
    const { play } = useShogiMatchConfig();
    const { navigationState } = useNavigation();
    const { moves, isAnalyzing } = useCurrentPositionAiHints();
    // 対局エンジンの読み筋を勝手に出さないよう、ヒントを求めた局面でだけ出す。
    const isForThisPosition = play?.hintPly === navigationState.currentPly;
    const shown = isForThisPosition && play?.phase === "playing" ? moves : [];
    return {
        moves: shown,
        isThinking: isForThisPosition && isAnalyzing && shown.length === 0,
        isAnalyzing,
    };
}

/** 盤に示すヒントの手（いちばんの候補）。無ければ null。 */
export function usePlayHintMove(): { from: string | null; to: string } | null {
    const { moves } = useShownHints();
    const usi = moves[0]?.usi;
    if (!usi) return null;
    // 打つ手は "P*5e"、動かす手は "7g7f" / "7g7f+"
    if (usi[1] === "*") return { from: null, to: usi.slice(2, 4) };
    return { from: usi.slice(0, 2), to: usi.slice(2, 4) };
}

/** 評価値を、手番の人から見た言葉にする。 */
export function describeEval(
    move: Pick<AiHintMove, "evalCp" | "evalMate">,
    viewer: Player,
): { text: string; tone: "good" | "bad" | "even" } {
    const sign = viewer === "sente" ? 1 : -1;
    if (move.evalMate !== undefined && move.evalMate !== null) {
        return move.evalMate * sign > 0
            ? { text: "詰みがあります", tone: "good" }
            : { text: "詰まされそうです", tone: "bad" };
    }
    if (move.evalCp === undefined || move.evalCp === null) return { text: "", tone: "even" };
    const value = move.evalCp * sign;
    const size = Math.abs(value);
    if (size < 150) return { text: "互角", tone: "even" };
    const good = value > 0;
    const word =
        size < 500
            ? good
                ? "やや有利"
                : "やや不利"
            : size < 1200
              ? good
                  ? "有利"
                  : "不利"
              : size < 2500
                ? good
                    ? "優勢"
                    : "劣勢"
                : good
                  ? "勝勢"
                  : "敗勢";
    return { text: word, tone: good ? "good" : "bad" };
}

interface PlayHintCardProps {
    /** 枠で囲まず、詰めて出す（スマホの盤の下） */
    compact?: boolean;
    className?: string;
}

export function PlayHintCard({ compact = false, className }: PlayHintCardProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const { position, sides, gameMode } = useMatchState();
    const { moves, isThinking, isAnalyzing } = useShownHints();

    const isMyTurn = gameMode === "playing" && sides[position.turn].role === "human";
    const idleText =
        gameMode === "paused"
            ? "一時停止中は使えません。"
            : isMyTurn
              ? "いまの局面で AI が勧める手を、盤に示します。"
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
                    variant="outline"
                    className="min-h-10"
                    onClick={() => play?.requestHint()}
                    disabled={!isMyTurn || isAnalyzing}
                >
                    {isThinking ? "考え中…" : moves.length > 0 ? "もう一度" : "ヒントを見る"}
                </Button>
            </div>
            {moves.length > 0 ? (
                <ol className="flex flex-col gap-1" aria-live="polite">
                    {moves.map((move, index) => {
                        const evaluation = describeEval(move, position.turn);
                        return (
                            <li
                                key={move.usi}
                                className={cn(
                                    "flex items-baseline gap-2 rounded-md px-2 py-1 text-sm",
                                    index === 0 && "bg-wafuu-ai/10",
                                )}
                            >
                                <span className="w-14 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                                    {index === 0 ? "おすすめ" : `${index + 1}番目`}
                                </span>
                                <span
                                    className={cn(
                                        "flex-1 text-foreground",
                                        index === 0 && "font-semibold",
                                    )}
                                >
                                    {move.displayText}
                                </span>
                                <span className="shrink-0 text-xs text-wafuu-sumi">
                                    {evaluation.text}
                                    {move.scoreText && (
                                        <span
                                            className={cn(
                                                "pl-1 font-mono tabular-nums",
                                                position.turn === "sente"
                                                    ? "text-wafuu-shu"
                                                    : "text-wafuu-ai",
                                            )}
                                        >
                                            {move.scoreText}
                                        </span>
                                    )}
                                </span>
                            </li>
                        );
                    })}
                </ol>
            ) : (
                <p className="text-xs leading-relaxed text-muted-foreground" aria-live="polite">
                    {isThinking ? "候補手を調べています…" : idleText}
                </p>
            )}
            {moves.length > 0 && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                    盤の青い枠が、おすすめの手（点線 = 動かす駒、塗り = 行き先）です。
                </p>
            )}
        </section>
    );
}

/** ヒントを求めるボタン（スマホの操作の行に置く）。 */
export function PlayHintButton({ className }: { className?: string }): ReactElement {
    const { play } = useShogiMatchConfig();
    const { position, sides, gameMode } = useMatchState();
    const { isThinking, isAnalyzing } = useShownHints();
    const isMyTurn = gameMode === "playing" && sides[position.turn].role === "human";
    return (
        <Button
            type="button"
            variant="outline"
            className={cn("min-h-10", className)}
            onClick={() => play?.requestHint()}
            disabled={!isMyTurn || isAnalyzing}
        >
            {isThinking ? "考え中…" : "ヒント"}
        </Button>
    );
}

/**
 * ヒントの結果を 1 行で出す（スマホの盤のすぐ下）。結果が無いときは `fallback` を出す。
 * 盤の枠と合わせて読むので、いちばんの候補だけを書く。
 */
export function PlayHintLine({
    fallback,
    className,
}: {
    fallback: ReactNode;
    className?: string;
}): ReactElement {
    const { position } = useMatchState();
    const { moves, isThinking } = useShownHints();
    const best = moves[0];
    if (!best) {
        return (
            <div className={className} aria-live="polite">
                {isThinking ? (
                    <span className="text-sm text-muted-foreground">候補手を調べています…</span>
                ) : (
                    fallback
                )}
            </div>
        );
    }
    const evaluation = describeEval(best, position.turn);
    return (
        <output className={cn("flex items-baseline gap-2 text-sm", className)} aria-live="polite">
            <span className="shrink-0 rounded bg-wafuu-ai px-1.5 py-0.5 text-xs font-semibold text-wafuu-ai-fg">
                ヒント
            </span>
            <span className="truncate font-semibold text-foreground">{best.displayText}</span>
            <span className="shrink-0 text-xs text-wafuu-sumi">
                {evaluation.text}
                {best.scoreText && (
                    <span className="pl-1 font-mono tabular-nums text-muted-foreground">
                        {best.scoreText}
                    </span>
                )}
            </span>
        </output>
    );
}
