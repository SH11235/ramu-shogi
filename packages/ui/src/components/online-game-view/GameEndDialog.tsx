import type { GameResult } from "@shogi/match-client";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { formatGameEndReason, formatGameResultTitle } from "./gameResultText";

interface GameEndDialogProps {
    result: GameResult;
    kifu: string;
    playerNames: { b: string; w: string };
    onDownloadKifu: () => void;
    analysisLog: Array<{ seat: "b" | "w"; ply: number }>;
    onStartReview?: () => void;
    onExit?: () => void;
    onDismiss: () => void;
}

export function GameEndDialog({
    result,
    kifu,
    playerNames,
    onDownloadKifu,
    analysisLog,
    onStartReview,
    onExit,
    onDismiss,
}: GameEndDialogProps): ReactElement {
    const [kifuCopied, setKifuCopied] = useState(false);
    useEffect(() => {
        if (!kifuCopied) return;
        const timerId = setTimeout(() => setKifuCopied(false), 2000);
        return () => clearTimeout(timerId);
    }, [kifuCopied]);

    // 背景の盤を操作できないモーダルなので、開いたらフォーカスをダイアログの中へ移す
    const dialogRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        dialogRef.current?.focus();
    }, []);

    const bAnalysisCount = analysisLog.filter((e) => e.seat === "b").length;
    const wAnalysisCount = analysisLog.filter((e) => e.seat === "w").length;

    return (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-overlay p-4">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="game-end-dialog-title"
                tabIndex={-1}
                onKeyDown={(e) => {
                    if (e.key === "Escape") onDismiss();
                }}
                className="max-h-full min-w-[280px] max-w-sm overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl focus-visible:outline-none"
            >
                <h2
                    id="game-end-dialog-title"
                    className="mb-3 text-center text-xl font-bold text-foreground"
                >
                    {formatGameResultTitle(result, playerNames)}
                </h2>
                <p className="mb-5 text-center text-sm text-muted-foreground">
                    {formatGameEndReason(result)}
                </p>

                {/* 解析ログ開示 */}
                {analysisLog.length > 0 && (
                    <div className="mb-4 rounded-md border border-border bg-muted/30 p-3">
                        <p className="mb-2 text-xs font-semibold text-foreground">
                            AI 解析使用回数
                        </p>
                        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                            <div className="flex justify-between">
                                <span className="text-wafuu-shu">▲ {playerNames.b}</span>
                                <span>{bAnalysisCount} 回</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-wafuu-ai">△ {playerNames.w}</span>
                                <span>{wAnalysisCount} 回</span>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-2">
                    {onStartReview && (
                        <button
                            type="button"
                            onClick={onStartReview}
                            className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                        >
                            棋譜を検討する
                        </button>
                    )}
                    {kifu && (
                        <>
                            <button
                                type="button"
                                onClick={async () => {
                                    await navigator.clipboard.writeText(kifu);
                                    setKifuCopied(true);
                                }}
                                className="w-full rounded-lg bg-secondary py-2 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80"
                            >
                                {kifuCopied ? "コピーしました！" : "棋譜をコピー"}
                            </button>
                            <button
                                type="button"
                                onClick={onDownloadKifu}
                                className="w-full rounded-lg bg-secondary py-2 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80"
                            >
                                棋譜をダウンロード
                            </button>
                        </>
                    )}
                    {onExit && (
                        <button
                            type="button"
                            onClick={onExit}
                            className="w-full rounded-lg bg-secondary py-2 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80"
                        >
                            トップへ戻る
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="w-full rounded-lg border border-border bg-card py-2 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        盤面を見る
                    </button>
                </div>
            </div>
        </div>
    );
}
