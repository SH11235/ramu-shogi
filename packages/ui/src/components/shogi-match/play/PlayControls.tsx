/**
 * 対局画面の、盤のまわりの小さな部品（手番の表示、対局中・一時停止中の操作、局面編集の欄）。
 * PC・スマホのレイアウトで共用する。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode, RefObject } from "react";
import { useEffect, useRef } from "react";
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
import { ChoiceGroup } from "../../choice-group";
import { PassButton } from "../components/PassButton";
import { PlayerIcon } from "../components/PlayerIcon";
import { SoundToggle } from "../components/SoundToggle";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { ILLEGAL_MOVE_MESSAGE } from "../hooks/useMoveExecution";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { Message } from "../types";
import { PLAY_HEADING, PLAY_OUTLINE_BUTTON, PLAY_PRIMARY_BUTTON } from "./playStyles";

const MESSAGE_STYLES: Record<Message["type"], string> = {
    error: "text-destructive",
    warning: "text-status-warning",
    success: "text-status-success",
};

/** 対局画面では、硬い言い回しをやさしい言葉に言い換える。 */
const MESSAGE_REWORDS: Record<string, string> = {
    [ILLEGAL_MOVE_MESSAGE]: "そこには動かせません",
};

/**
 * 進み具合（設定 → 対局 → 終局など）が変わったら、その画面の見出しへフォーカスを移す。
 * 「対局開始」や投了の確認のように、押したボタンが画面から消える操作のあとに、キーボードや
 * 読み上げの利用者が現在地を失わないようにする。返す ref を、レイアウトの外側の要素に付ける。
 */
export function usePlayPhaseFocus<T extends HTMLElement>(phase: string): RefObject<T | null> {
    const rootRef = useRef<T>(null);
    const previousPhase = useRef(phase);
    useEffect(() => {
        if (previousPhase.current === phase) return;
        previousPhase.current = phase;
        rootRef.current
            ?.querySelector<HTMLElement>("[data-play-heading]")
            ?.focus({ preventScroll: true });
    }, [phase]);
    return rootRef;
}

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
            {play?.startNotice && (
                <span className="text-xs font-normal text-wafuu-sumi-light">
                    {play.startNotice}
                </span>
            )}
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
    const { timeSettings } = useMatchSettings();
    if (!play) return null;
    const bothEngines = sides.sente.role === "engine" && sides.gote.role === "engine";
    const bothHumans = sides.sente.role === "human" && sides.gote.role === "human";
    // 一時停止が役に立つのは、人の時計が動いている対局（離れても時間切れにしない）と、AI 同士の対局
    // （止めて局面を見る）だけ。人の時間が無制限なら止めても得るものが無く、ヒントの「止める」と紛れる。
    const canPause =
        bothEngines ||
        (["sente", "gote"] as const).some(
            (side) => sides[side].role === "human" && timeSettings[side].enabled,
        );
    // 待ったは「自分の指した手」を取り消す操作。自分がまだ指していない（相手の初手だけ）なら使えない。
    // 数えるのは、この対局で指した手だけ（引き継いだ棋譜の手は戻さない）。
    const playedMoves = moves.length - play.startPly;
    const hasOwnMove = bothHumans ? playedMoves >= 1 : playedMoves >= 2;
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
                    onClick={() => play.startMatch()}
                >
                    対局を再開
                </Button>
                <ConfirmButton
                    label="対局をやめる"
                    title="対局をやめますか？"
                    description="この対局の棋譜は残りません。設定の画面に戻ります。"
                    actionLabel="やめる"
                    onConfirm={play.newGame}
                    // 止めている間の選択肢はこの 2 つだけなので、離さずに並べる（投了のように右端へ寄せない）。
                    className={itemClass}
                />
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
            {canPause && (
                <Button
                    type="button"
                    variant="outline"
                    className={cn(PLAY_OUTLINE_BUTTON, itemClass)}
                    onClick={pauseAutoPlay}
                >
                    一時停止
                </Button>
            )}
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

const FLIP_SIZE_CLASS = {
    md: { button: "h-8 w-8", icon: "h-[18px] w-[18px]" },
    lg: { button: "h-11 w-11", icon: "h-[26px] w-[26px]" },
} as const;

/**
 * 盤の横の操作（盤の向きと着手音）。どの対局の組み合わせでも同じ 2 つを同じ大きさで置く
 * （組み合わせや段階でボタンが出たり消えたりすると、どこへ行ったか分からなくなる）。
 */
export function PlayBoardTools({
    className,
    size = "md",
}: {
    className?: string;
    size?: "md" | "lg";
}): ReactElement {
    const { flipBoard, onFlipBoardChange } = useMatchState();
    const flipSize = FLIP_SIZE_CLASS[size];
    return (
        <div className={cn("flex shrink-0 items-center gap-1", className)}>
            <button
                type="button"
                onClick={() => onFlipBoardChange(!flipBoard)}
                aria-pressed={flipBoard}
                aria-label="盤面を反転"
                title="盤面を反転"
                className={cn(
                    "flex shrink-0 items-center justify-center rounded-md border border-wafuu-border text-wafuu-sumi transition-colors hover:bg-wafuu-washi-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    flipSize.button,
                    flipBoard ? "bg-wafuu-kin/20" : "bg-card",
                )}
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={flipSize.icon}
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
            <SoundToggle size={size} />
        </div>
    );
}

/** 開始局面の編集中に出す欄（編集を終える操作と、短い説明）。 */
export function PlayPositionEditorPanel({
    className,
    hideHeading = false,
    stickyPrimary = false,
}: {
    className?: string;
    /** 見出しを出さない（スマホでは、盤の上に見出しを置く） */
    hideHeading?: boolean;
    /** 「この局面に決める」を画面の下端に留める（スマホ） */
    stickyPrimary?: boolean;
}): ReactElement {
    const { play } = useShogiMatchConfig();
    const { sides } = useMatchState();
    // 人 対 人では、どちらも「あなた」になるので、名前は出さず先手・後手の印だけで示す。
    const bothHumans = sides.sente.role === "human" && sides.gote.role === "human";
    const actions = (
        <div
            className={cn(
                "flex flex-col gap-2",
                stickyPrimary && "sticky bottom-0 z-10 bg-background pb-2 pt-1",
            )}
        >
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
    );

    return (
        <section aria-label="開始局面の編集" className={cn("flex flex-col gap-4", className)}>
            {!hideHeading && (
                <h1
                    id="play-editor-heading"
                    data-play-heading
                    tabIndex={-1}
                    className={cn(PLAY_HEADING, "outline-none")}
                >
                    開始局面を編集
                </h1>
            )}
            {/* スマホ（操作を下端に留める形）では、盤と操作を 1 画面に収めるため、操作の説明を省く。 */}
            {!stickyPrimary && (
                <p className="text-[13px] leading-relaxed text-wafuu-sumi-light">
                    駒はドラッグで動かし、盤の外へ出すと取り除けます（成・不成は 2 回押し）。
                </p>
            )}
            {/* 先後は駒の向きで決まっているので、選ぶのは局面から先に指す対局者（あなた・AI）。 */}
            <fieldset className={cn("flex", stickyPrimary ? "items-center gap-2" : "flex-col")}>
                <legend
                    className={
                        stickyPrimary
                            ? "sr-only"
                            : "pb-1.5 text-xs font-medium text-wafuu-sumi-light"
                    }
                >
                    この局面から先に指すのは
                </legend>
                {stickyPrimary && (
                    <span
                        aria-hidden
                        className="shrink-0 text-xs font-medium text-wafuu-sumi-light"
                    >
                        先に指す
                    </span>
                )}
                <ChoiceGroup
                    options={(["sente", "gote"] as const).map((side) => {
                        const mark = side === "sente" ? "☗" : "☖";
                        const name = bothHumans ? null : (play?.playerNames[side] ?? null);
                        return {
                            value: side,
                            ariaLabel: `${name ?? mark}（${side === "sente" ? "先手" : "後手"}）`,
                            label: (
                                <>
                                    <PlayerIcon
                                        side={side}
                                        isAI={sides[side].role === "engine"}
                                        size="md"
                                    />
                                    {name && <span className="truncate">{name}</span>}
                                </>
                            ),
                        };
                    })}
                    value={play?.editTurn ?? null}
                    onChange={(side) => play?.setEditTurn(side)}
                    size="lg"
                    layout="fill"
                    className="min-w-0 flex-1 flex-nowrap"
                />
            </fieldset>
            {/* 決める操作は、編集と手番を選び終えた後の最後に置く（見た目と Tab の順を合わせる）。 */}
            {actions}
        </section>
    );
}
