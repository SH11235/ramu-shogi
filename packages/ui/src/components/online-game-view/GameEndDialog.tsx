import type { GameResult } from "@shogi/match-client";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../dialog";
import { formatGameEndReason, formatGameResultTitle } from "./gameResultText";

interface GameEndDialogProps {
    open: boolean;
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
    open,
    onDismiss,
    ...contentProps
}: GameEndDialogProps): ReactElement {
    const contentRef = useRef<HTMLDivElement>(null);
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onDismiss();
            }}
        >
            <DialogContent
                ref={contentRef}
                hasDescription
                // 先頭のボタンへ移すと、終局の直後に押した Enter やスペースで「棋譜を検討する」が押されてしまう
                onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    contentRef.current?.focus();
                }}
                // 閉じたら盤の下の「結果を表示」がフォーカスを受け取るので、元の要素へ戻さない
                onCloseAutoFocus={(e) => e.preventDefault()}
                // 終局の瞬間に指そうとして盤を押しても、結果を見ないまま閉じないようにする
                onInteractOutside={(e) => e.preventDefault()}
                className="w-fit min-w-[280px] max-w-[min(24rem,calc(100%-32px))] max-h-[calc(100%-32px)] overflow-y-auto focus-visible:outline-none"
            >
                <GameEndDialogBody {...contentProps} onDismiss={onDismiss} />
            </DialogContent>
        </Dialog>
    );
}

function GameEndDialogBody({
    result,
    kifu,
    playerNames,
    onDownloadKifu,
    analysisLog,
    onStartReview,
    onExit,
    onDismiss,
}: Omit<GameEndDialogProps, "open">): ReactElement {
    const [kifuCopied, setKifuCopied] = useState(false);
    useEffect(() => {
        if (!kifuCopied) return;
        const timerId = setTimeout(() => setKifuCopied(false), 2000);
        return () => clearTimeout(timerId);
    }, [kifuCopied]);

    const bAnalysisCount = analysisLog.filter((e) => e.seat === "b").length;
    const wAnalysisCount = analysisLog.filter((e) => e.seat === "w").length;

    return (
        <>
            <DialogTitle className="mb-3 text-center text-xl font-bold leading-7 tracking-normal">
                {formatGameResultTitle(result, playerNames)}
            </DialogTitle>
            <DialogDescription className="mb-5 text-center">
                {formatGameEndReason(result)}
            </DialogDescription>

            {/* 解析ログ開示 */}
            {analysisLog.length > 0 && (
                <div className="mb-4 rounded-md border border-border bg-muted/30 p-3">
                    <p className="mb-2 text-xs font-semibold text-foreground">AI 解析使用回数</p>
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
        </>
    );
}
