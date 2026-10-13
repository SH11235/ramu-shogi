/**
 * 終局の表示（対局画面）。結果と、次にすること（研究ノートで振り返る・もう一局）を出す。
 *
 * 終局の瞬間はダイアログで知らせ、閉じたあとも同じ内容を欄として残す。
 */

import type { GameResult } from "@shogi/app-core";
import { getReasonText, getWinnerLabel } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../../button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../dialog";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";

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

function ResultSummary({ result }: { result: GameResult }): ReactElement {
    const { play } = useShogiMatchConfig();
    const headline = useResultHeadline(result);
    return (
        <div className="flex flex-col gap-1">
            <p
                className={cn(
                    "font-display text-2xl font-semibold",
                    headline.tone === "win"
                        ? "text-wafuu-shu"
                        : headline.tone === "lose"
                          ? "text-wafuu-ai"
                          : "text-wafuu-sumi",
                )}
            >
                {headline.text}
            </p>
            <p className="text-sm text-wafuu-sumi-light">
                {getReasonText(result.reason)} ・ {result.totalMoves}手まで
                {play && play.hintCount > 0 ? ` ・ ヒント ${play.hintCount} 回` : ""}
            </p>
        </div>
    );
}

function ResultActions({ onAfterAction }: { onAfterAction?: () => void }): ReactElement {
    const { play } = useShogiMatchConfig();
    const { handleCopyKif } = useNavigation();
    const [copied, setCopied] = useState(false);

    const copyKif = () => {
        const text = handleCopyKif();
        void navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
    };

    return (
        <div className="flex flex-col gap-2">
            {play?.openStudy && (
                <>
                    <Button
                        type="button"
                        size="lg"
                        className="h-12 w-full text-base font-semibold"
                        onClick={() => {
                            onAfterAction?.();
                            play.openStudy?.();
                        }}
                    >
                        研究ノートで振り返る
                    </Button>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        この対局を研究ノートに保存して、AI
                        の解析で悪手を探したり、変化やコメントを残したりできます。
                    </p>
                </>
            )}
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                        onAfterAction?.();
                        play?.newGame();
                    }}
                >
                    もう一局
                </Button>
                <Button type="button" variant="ghost" onClick={copyKif}>
                    {copied ? "コピーしました" : "棋譜をコピー"}
                </Button>
            </div>
        </div>
    );
}

/** 終局後に残る欄。 */
export function PlayResultCard({ className }: { className?: string }): ReactElement | null {
    const { play } = useShogiMatchConfig();
    const result = play?.gameResult;
    if (!result) return null;
    return (
        <section
            aria-label="対局結果"
            className={cn(
                "flex flex-col gap-4 rounded-xl border border-wafuu-border bg-card p-5 shadow-card",
                className,
            )}
        >
            <ResultSummary result={result} />
            <ResultActions />
        </section>
    );
}

/** 終局の瞬間に出すダイアログ。 */
export function PlayResultDialog(): ReactElement | null {
    const { play } = useShogiMatchConfig();
    const result = play?.gameResult;
    if (!play || !result) return null;
    return (
        <Dialog
            open={play.resultDialogOpen}
            onOpenChange={(open) => {
                if (!open) play.closeResultDialog();
            }}
        >
            <DialogContent className="w-[min(420px,calc(100%-32px))]" hasDescription>
                <div className="flex flex-col gap-4">
                    <DialogHeader>
                        <DialogTitle>対局終了</DialogTitle>
                        <DialogDescription className="sr-only">
                            対局の結果と、次にできること
                        </DialogDescription>
                    </DialogHeader>
                    <ResultSummary result={result} />
                    <ResultActions onAfterAction={play.closeResultDialog} />
                </div>
            </DialogContent>
        </Dialog>
    );
}
