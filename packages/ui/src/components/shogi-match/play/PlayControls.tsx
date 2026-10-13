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
import { SoundToggle } from "../components/SoundToggle";
import { useMatchState } from "../contexts/MatchStateContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { Message } from "../types";
import { PLAY_HEADING, PLAY_OUTLINE_BUTTON, PLAY_PRIMARY_BUTTON } from "./playStyles";

const MESSAGE_STYLES: Record<Message["type"], string> = {
    error: "text-destructive",
    warning: "text-yellow-600 dark:text-yellow-500",
    success: "text-green-600 dark:text-green-500",
};

/** 対局画面では、硬い言い回しをやさしい言葉に言い換える。 */
const MESSAGE_REWORDS: Record<string, string> = {
    合法手ではありません: "そこには動かせません",
};

/** エラーなどの知らせ。盤の列を横に広げないよう、幅の計算には加えず列の幅で折り返す。 */
export function PlayMessage({ className }: { className?: string }): ReactElement | null {
    const { message } = useMatchState();
    if (!message) return null;
    return (
        <p
            role={message.type === "error" ? "alert" : "status"}
            className={cn(
                "w-0 min-w-full whitespace-pre-line break-words text-center text-sm",
                MESSAGE_STYLES[message.type],
                className,
            )}
        >
            {MESSAGE_REWORDS[message.text] ?? message.text}
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
                <span className="text-xs font-normal tabular-nums text-wafuu-sumi-light">
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
    className,
}: {
    label: string;
    title: string;
    description: string;
    actionLabel: string;
    onConfirm: () => void;
    className?: string;
}): ReactElement {
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className={cn(PLAY_OUTLINE_BUTTON, className)}
                >
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

/**
 * 対局中・一時停止中の操作（待った・投了・一時停止／再開・やめる）。
 *
 * 並びは対局中も一時停止中も同じ: 左に続ける操作、右端に取り返しのつかない操作（投了・やめる）。
 */
export function PlayMatchActions({
    compact = false,
    extra,
    className,
}: {
    /** スマホ向けに、ボタンを等幅で 1 段に並べる */
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
    const bothHumans = sides.sente.role === "human" && sides.gote.role === "human";
    // 待ったは「自分の指した手」を取り消す操作。自分がまだ指していない（相手の初手だけ）なら使えない。
    const hasOwnMove = bothHumans ? moves.length >= 1 : moves.length >= 2;
    const canUndo = hasOwnMove && !bothEngines && sides[position.turn].role === "human";
    // スマホでは等幅で 1 段に収める（狭い幅で投了だけ 2 段目に落ちないように）。
    const itemClass = compact ? "flex-1 px-2" : "";
    const rowClass = cn("flex w-full items-center gap-2", !compact && "flex-wrap", className);

    if (play.phase === "paused") {
        return (
            <div className={rowClass}>
                <Button
                    type="button"
                    className={cn("min-h-10", PLAY_PRIMARY_BUTTON, itemClass)}
                    onClick={play.startMatch}
                >
                    対局を再開
                </Button>
                <ConfirmButton
                    label="対局をやめる"
                    title="対局をやめますか？"
                    description="この対局の棋譜は残りません。設定の画面に戻ります。"
                    actionLabel="やめる"
                    onConfirm={play.newGame}
                    className={cn(!compact && "ml-auto", itemClass)}
                />
                {!bothEngines && (
                    <ConfirmButton
                        label="投了"
                        title="投了しますか？"
                        description="対局を終了します。"
                        actionLabel="投了する"
                        onConfirm={handleResign}
                        className={itemClass}
                    />
                )}
            </div>
        );
    }
    if (play.phase !== "playing") return null;

    return (
        <div className={rowClass}>
            {!bothEngines && (
                <Button
                    type="button"
                    variant="outline"
                    className={cn(PLAY_OUTLINE_BUTTON, itemClass)}
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
            <Button
                type="button"
                variant="outline"
                className={cn(PLAY_OUTLINE_BUTTON, itemClass)}
                onClick={pauseAutoPlay}
            >
                一時停止
            </Button>
            {!bothEngines && (
                <ConfirmButton
                    label="投了"
                    title="投了しますか？"
                    description="対局を終了します。"
                    actionLabel="投了する"
                    onConfirm={handleResign}
                    className={cn(!compact && "ml-auto", itemClass)}
                />
            )}
        </div>
    );
}

/** 盤の向きと音（盤の表示の操作）。線のアイコンで、ほかの操作より控えめに置く。 */
export function PlayBoardTools({ className }: { className?: string }): ReactElement {
    const { flipBoard, onFlipBoardChange } = useMatchState();
    return (
        <div className={cn("flex shrink-0 items-center gap-1", className)}>
            <button
                type="button"
                onClick={() => onFlipBoardChange(!flipBoard)}
                aria-pressed={flipBoard}
                aria-label="盤面を反転"
                title="盤面を反転"
                className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md border border-wafuu-border text-wafuu-sumi transition-colors hover:bg-wafuu-washi-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    flipBoard ? "bg-wafuu-kin/20" : "bg-background",
                )}
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M7 4v16" />
                    <path d="m3 8 4-4 4 4" />
                    <path d="M17 20V4" />
                    <path d="m21 16-4 4-4-4" />
                </svg>
            </button>
            <SoundToggle />
        </div>
    );
}

/** 開始局面の編集中に出す欄（編集を終える操作と、短い説明）。 */
export function PlayPositionEditorPanel({ className }: { className?: string }): ReactElement {
    const { play } = useShogiMatchConfig();
    return (
        <section
            aria-labelledby="play-editor-heading"
            className={cn("flex flex-col gap-4", className)}
        >
            <h1 id="play-editor-heading" className={PLAY_HEADING}>
                開始局面を編集
            </h1>
            <div className="flex flex-col gap-2">
                <Button
                    type="button"
                    size="lg"
                    className={cn("h-12 w-full text-base font-semibold", PLAY_PRIMARY_BUTTON)}
                    onClick={() => play?.closePositionEditor()}
                >
                    この局面に決める
                </Button>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        className={cn("flex-1", PLAY_OUTLINE_BUTTON)}
                        onClick={() => play?.resetToStartpos()}
                    >
                        平手に戻す
                    </Button>
                    {play?.openStudy && (
                        <Button
                            type="button"
                            variant="outline"
                            className={cn("flex-1", PLAY_OUTLINE_BUTTON)}
                            onClick={() => play.openStudy?.()}
                        >
                            研究ノートで調べる
                        </Button>
                    )}
                </div>
            </div>
            <fieldset className="flex flex-col">
                <legend className="pb-1.5 text-xs font-medium text-wafuu-sumi-light">
                    どちらから指し始めるか
                </legend>
                <div className="flex gap-1.5">
                    {(["sente", "gote"] as const).map((side) => {
                        const selected = play?.editTurn === side;
                        return (
                            <button
                                key={side}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => play?.setEditTurn(side)}
                                className={cn(
                                    "min-h-10 flex-1 rounded-md border px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9",
                                    selected
                                        ? "border-wafuu-shu bg-wafuu-shu/10 text-wafuu-shu"
                                        : "border-wafuu-border bg-background text-wafuu-sumi hover:bg-wafuu-washi-warm",
                                )}
                            >
                                {side === "sente" ? "☗ 先手から" : "☖ 後手から"}
                            </button>
                        );
                    })}
                </div>
            </fieldset>
            <p className="text-[13px] leading-relaxed text-wafuu-sumi-light">
                駒はドラッグで動かし、盤の外へ出すと取り除けます。成・不成は 2
                回続けて押すと切り替わります。持ち駒は「＋」「−」で増減します。
            </p>
        </section>
    );
}
