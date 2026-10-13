/**
 * 終局の表示（対局画面）。結果と、次にすること（研究ノートで振り返る・もう一局）を出す。
 *
 * 結果は画面の見出しとして出す（ダイアログでは重ねない。同じ内容を二度出さない）。
 */

import type { GameResult } from "@shogi/app-core";
import { getReasonText, getWinnerLabel } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../../button";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import { PLAY_OUTLINE_BUTTON, PLAY_PRIMARY_BUTTON, PLAY_TEXT_LINK } from "./playStyles";

/** 結果の見出し。人が片方だけなら「あなたの勝ち／負け」、それ以外は「先手の勝ち」など。 */
function useResultHeadline(result: GameResult): { text: string; tone: "win" | "lose" | "plain" } {
    const { sides } = useMatchState();
    const senteIsHuman = sides.sente.role === "human";
    const goteIsHuman = sides.gote.role === "human";
    if (senteIsHuman !== goteIsHuman && result.winner) {
        const mySide = senteIsHuman ? "sente" : "gote";
        return result.winner === mySide
            ? { text: "あなたの勝ち", tone: "win" }
            : { text: "あなたの負け", tone: "lose" };
    }
    return { text: getWinnerLabel(result.winner), tone: "plain" };
}

interface PlayResultCardProps {
    /** スマホ向けに詰める（見出しと操作を小さくまとめる） */
    compact?: boolean;
    /** 「設定を変える」「棋譜をコピー」を出さない（`PlayResultLinks` を別の場所に置くとき） */
    hideLinks?: boolean;
    className?: string;
}

/** 終局後の欄。結果を見出しとして出し、次の一歩を並べる。 */
export function PlayResultCard({
    compact = false,
    hideLinks = false,
    className,
}: PlayResultCardProps): ReactElement | null {
    const { play } = useShogiMatchConfig();
    const result = play?.gameResult;
    if (!play || !result) return null;

    return (
        <section
            aria-label="対局結果"
            aria-live="polite"
            className={cn("flex flex-col", compact ? "gap-2.5" : "gap-4", className)}
        >
            <ResultSummary result={result} compact={compact} />
            <div className={cn("flex gap-2", compact ? "flex-row" : "flex-col")}>
                {play.openStudy && (
                    <Button
                        type="button"
                        size={compact ? "default" : "lg"}
                        className={cn(
                            "font-semibold",
                            compact ? "min-h-11 flex-1 px-2" : "h-12 w-full text-base",
                            PLAY_PRIMARY_BUTTON,
                        )}
                        onClick={() => play.openStudy?.()}
                    >
                        研究ノートで振り返る
                    </Button>
                )}
                <Button
                    type="button"
                    variant="outline"
                    className={cn(PLAY_OUTLINE_BUTTON, compact ? "min-h-11 flex-1 px-2" : "w-full")}
                    onClick={play.rematch}
                >
                    もう一局
                </Button>
            </div>
            {!hideLinks && <PlayResultLinks />}
        </section>
    );
}

/** 終局後の、主でない操作（設定を変える・棋譜をコピー）。 */
export function PlayResultLinks({ className }: { className?: string }): ReactElement | null {
    const { play } = useShogiMatchConfig();
    const { handleCopyKif } = useNavigation();
    const [copied, setCopied] = useState(false);
    if (!play?.gameResult) return null;

    const copyKif = () => {
        const text = handleCopyKif();
        void navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
    };

    return (
        <div
            className={cn(
                "flex flex-wrap items-center gap-x-4 text-[13px] text-wafuu-sumi-light",
                className,
            )}
        >
            <button
                type="button"
                onClick={play.newGame}
                className={cn(PLAY_TEXT_LINK, "hover:text-wafuu-sumi")}
            >
                設定を変える
            </button>
            <button
                type="button"
                onClick={copyKif}
                className={cn(PLAY_TEXT_LINK, "hover:text-wafuu-sumi")}
            >
                {copied ? "コピーしました" : "棋譜をコピー"}
            </button>
        </div>
    );
}

function ResultSummary({
    result,
    compact = false,
}: {
    result: GameResult;
    /** 見出しと要約を 1 行に並べる（スマホの下端の帯） */
    compact?: boolean;
}): ReactElement {
    const { play } = useShogiMatchConfig();
    const headline = useResultHeadline(result);
    return (
        <div
            className={cn(
                "flex",
                compact ? "flex-wrap items-baseline gap-x-3" : "flex-col gap-0.5",
            )}
        >
            <h1
                tabIndex={-1}
                className={cn(
                    "font-display font-semibold outline-none",
                    compact ? "text-xl" : "text-2xl",
                    // 色は勝敗でなく、勝った側の色（先手 = 朱、後手 = 藍）。
                    result.winner === "sente"
                        ? "text-wafuu-shu"
                        : result.winner === "gote"
                          ? "text-wafuu-ai"
                          : "text-wafuu-sumi",
                )}
            >
                {headline.text}
            </h1>
            <p className={cn("text-wafuu-sumi-light", compact ? "text-xs" : "text-sm")}>
                {getReasonText(result.reason)} ・ {result.totalMoves}手まで
                {play && play.hintCount > 0 ? ` ・ ヒント ${play.hintCount} 回` : ""}
            </p>
        </div>
    );
}
