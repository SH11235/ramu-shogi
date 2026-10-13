/**
 * 対局画面の、盤のまわりの小さな部品（手番の表示、対局中・一時停止中の操作、局面編集の欄）。
 * PC・スマホのレイアウトで共用する。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "../../alert-dialog";
import { Button } from "../../button";
import { PassButton } from "../components/PassButton";
import { useMatchState } from "../contexts/MatchStateContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { Message } from "../types";

const MESSAGE_STYLES: Record<Message["type"], string> = {
    error: "text-destructive",
    warning: "text-yellow-600 dark:text-yellow-500",
    success: "text-green-600 dark:text-green-500",
};

/** エラーなどの知らせ。盤の列を横に広げないよう、幅の計算には加えず列の幅で折り返す。 */
export function PlayMessage(): ReactElement | null {
    const { message } = useMatchState();
    if (!message) return null;
    return (
        <p
            role={message.type === "error" ? "alert" : "status"}
            className={cn(
                "w-0 min-w-full whitespace-pre-line break-words text-center text-sm",
                MESSAGE_STYLES[message.type],
            )}
        >
            {message.text}
        </p>
    );
}

/** いまどちらの番か。人 対 AI のときは「あなたの番」「相手が考えています」と書く。 */
export function PlayTurnStatus({ className }: { className?: string }): ReactElement {
    const { play } = useShogiMatchConfig();
    const { position, sides, moves } = useMatchState();
    const phase = play?.phase;
    const turnIsHuman = sides[position.turn].role === "human";
    const isVsAi = (sides.sente.role === "human") !== (sides.gote.role === "human");
    const sideName = position.turn === "sente" ? "先手" : "後手";

    let text: string;
    let tone: "mine" | "theirs" | "plain" = "plain";
    const checkText = play?.inCheck ? "王手がかかっています" : null;
    if (phase === "paused") {
        text = "一時停止中";
    } else if (phase === "finished") {
        text = "終局";
    } else if (phase !== "playing") {
        text = "";
    } else if (isVsAi) {
        text = turnIsHuman ? "あなたの番です" : "相手が考えています…";
        tone = turnIsHuman ? "mine" : "theirs";
    } else {
        text = `${sideName}の番です`;
    }

    return (
        <output
            className={cn(
                "flex min-h-7 items-center gap-2 text-sm font-semibold",
                tone === "mine"
                    ? "text-wafuu-shu"
                    : tone === "theirs"
                      ? "text-wafuu-sumi-light"
                      : "text-wafuu-sumi",
                className,
            )}
        >
            {text}
            {checkText && (
                <span className="rounded bg-wafuu-shu px-1.5 py-0.5 text-xs font-semibold text-wafuu-shu-fg">
                    {checkText}
                </span>
            )}
            {phase === "playing" || phase === "paused" || phase === "finished" ? (
                <span className="text-xs font-normal tabular-nums text-muted-foreground">
                    {moves.length === 0 ? "開始局面" : `${moves.length}手目`}
                </span>
            ) : null}
        </output>
    );
}

function ConfirmButton({
    label,
    title,
    description,
    actionLabel,
    onConfirm,
    size,
    className,
}: {
    label: string;
    title: string;
    description: string;
    actionLabel: string;
    onConfirm: () => void;
    size?: "default" | "sm";
    className?: string;
}): ReactElement {
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" size={size} className={className}>
                    {label}
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>キャンセル</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>{actionLabel}</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

/** 対局中・一時停止中の操作（待った・投了・一時停止／再開・やめる）。 */
export function PlayMatchActions({
    compact = false,
    extra,
    className,
}: {
    /** スマホ向けに詰める */
    compact?: boolean;
    /** 「待った」の隣に足す操作（スマホのヒントのボタン） */
    extra?: ReactNode;
    className?: string;
}): ReactElement | null {
    const { play } = useShogiMatchConfig();
    const {
        moves,
        sides,
        position,
        handleUndo,
        handleResign,
        pauseAutoPlay,
        shouldRenderPassButton,
        canMakePassMove,
        passButtonDisabledReason,
        handlePassMove,
        shouldShowPassConfirm,
    } = useMatchState();
    if (!play) return null;
    const bothEngines = sides.sente.role === "engine" && sides.gote.role === "engine";
    const canUndo = moves.length > 0 && !bothEngines && sides[position.turn].role === "human";

    if (play.phase === "paused") {
        return (
            <div className={cn("flex flex-wrap items-center justify-center gap-2", className)}>
                <Button type="button" className="min-h-10" onClick={play.startMatch}>
                    対局を再開
                </Button>
                {!bothEngines && (
                    <ConfirmButton
                        label="投了"
                        title="投了しますか？"
                        description="対局を終了します。"
                        actionLabel="投了する"
                        onConfirm={handleResign}
                        className="min-h-10"
                    />
                )}
                <ConfirmButton
                    label="対局をやめる"
                    title="対局をやめますか？"
                    description="この対局の棋譜は残りません。設定の画面に戻ります。"
                    actionLabel="やめる"
                    onConfirm={play.newGame}
                    className="min-h-10"
                />
            </div>
        );
    }
    if (play.phase !== "playing") return null;

    // 並び: 待った ・（ヒント）・ パス ・ 一時停止 …… 投了。取り返しのつかない投了は端に離す。
    return (
        <div className={cn("flex w-full flex-wrap items-center gap-2", className)}>
            {!bothEngines && (
                <Button
                    type="button"
                    variant="outline"
                    className="min-h-10"
                    onClick={handleUndo}
                    disabled={!canUndo}
                >
                    待った
                </Button>
            )}
            {extra}
            {shouldRenderPassButton && position.passRights && (
                <PassButton
                    canPass={canMakePassMove}
                    disabledReason={passButtonDisabledReason}
                    onPass={handlePassMove}
                    remainingPassRights={position.passRights[position.turn]}
                    showConfirmDialog={shouldShowPassConfirm}
                    compact={compact}
                />
            )}
            <Button type="button" variant="outline" className="min-h-10" onClick={pauseAutoPlay}>
                一時停止
            </Button>
            {!bothEngines && (
                <ConfirmButton
                    label="投了"
                    title="投了しますか？"
                    description="対局を終了します。"
                    actionLabel="投了する"
                    onConfirm={handleResign}
                    className="ml-auto min-h-10"
                />
            )}
        </div>
    );
}

/** 開始局面の編集中に出す欄（説明と、編集を終える操作）。 */
export function PlayPositionEditorPanel({ className }: { className?: string }): ReactElement {
    const { play } = useShogiMatchConfig();
    return (
        <section
            aria-labelledby="play-editor-heading"
            className={cn(
                "flex flex-col gap-4 rounded-xl border border-wafuu-border bg-card p-5 shadow-card",
                className,
            )}
        >
            <div className="flex flex-col gap-1">
                <h1
                    id="play-editor-heading"
                    className="font-display text-2xl font-semibold text-wafuu-sumi"
                >
                    開始局面を編集
                </h1>
                <p className="text-[13px] leading-relaxed text-wafuu-sumi-light">
                    決めたら設定に戻り、相手と手番を選んで対局を始めます。
                </p>
            </div>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] leading-relaxed text-wafuu-sumi">
                <li>駒をドラッグして動かす（盤の外へ出すと取り除く）</li>
                <li>ダブルクリック（ダブルタップ）で成・不成を切り替える</li>
                <li>持ち駒は「＋」「−」で増減、盤へドラッグして置く</li>
            </ul>
            <div className="flex flex-col gap-2">
                <Button
                    type="button"
                    size="lg"
                    className="h-12 w-full text-base font-semibold"
                    onClick={() => play?.closePositionEditor()}
                >
                    この局面に決める
                </Button>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        onClick={() => play?.resetToStartpos()}
                    >
                        平手に戻す
                    </Button>
                    {play?.openStudy && (
                        <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={() => play.openStudy?.()}
                        >
                            研究ノートで調べる
                        </Button>
                    )}
                </div>
            </div>
        </section>
    );
}
