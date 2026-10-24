/**
 * 終局のダイアログ（対局画面）。盤に判子（PlayEndStamp）を押したあとに開き、結果と次の操作を出す。
 * PC は右の欄の上に重ね（盤と判子を隠さない）、スマホは下からのシートにする（ボタンを親指の位置に置く）。
 */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { GameResult } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../button";
import { useSurfaceTheme } from "../../surface-theme";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import { formatTimeRule } from "../utils/timeSettings";
import { isSelfResignation } from "./PlayEndStamp";
import { CopyKifButton, useReasonText, useResultHeadline, winnerColorClass } from "./PlayResult";
import { PLAY_OUTLINE_BUTTON, PLAY_PRIMARY_BUTTON } from "./playStyles";

// 判子を見せてから開く。判子は終局の 150ms 後に押され、押す動きに 300ms かかる
const REVEAL_DELAY_MS = 700;

const prefersReducedMotion = (): boolean =>
    typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/**
 * ダイアログを開いてよいか。終局から REVEAL_DELAY_MS 待つが、その間に画面を押したら待たせない。
 * 自分の投了（自分で終えたので知らせは要らない）と、動きを減らす設定ではすぐ開く。
 */
function useRevealed(result: GameResult | null, open: boolean, immediate: boolean): boolean {
    const [revealedFor, setRevealedFor] = useState<GameResult | null>(null);
    const waiting = result !== null && open && !immediate && revealedFor !== result;
    useEffect(() => {
        if (!waiting || !result) return;
        const reveal = () => setRevealedFor(result);
        const timer = setTimeout(reveal, REVEAL_DELAY_MS);
        document.addEventListener("pointerdown", reveal, true);
        document.addEventListener("keydown", reveal, true);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("pointerdown", reveal, true);
            document.removeEventListener("keydown", reveal, true);
        };
    }, [waiting, result]);
    return result !== null && open && (immediate || revealedFor === result);
}

/** 「もう一局」で始まる対局の設定（「先手・10分・簡易AI」）。AI どうしは出さない */
function useRematchSummary(): string | null {
    const { play } = useShogiMatchConfig();
    const { sides } = useMatchState();
    const { timeSettings } = useMatchSettings();
    const senteIsHuman = sides.sente.role === "human";
    const goteIsHuman = sides.gote.role === "human";
    if (!play || (!senteIsHuman && !goteIsHuman)) return null;
    const mySide = senteIsHuman ? "sente" : "gote";
    const clock = timeSettings[mySide];
    const time = clock.enabled ? formatTimeRule(clock, { perMove: true }) : "時間無制限";
    if (senteIsHuman && goteIsHuman) return time;
    const aiSide = mySide === "sente" ? "gote" : "sente";
    return `${mySide === "sente" ? "先手" : "後手"}・${time}・${play.playerNames[aiSide]}`;
}

interface PlayResultDialogProps {
    /** panel: PC の右の欄に重ねる。sheet: スマホの下からのシート */
    variant: "panel" | "sheet";
}

export function PlayResultDialog({ variant }: PlayResultDialogProps): ReactElement | null {
    const { play } = useShogiMatchConfig();
    const { sides } = useMatchState();
    const surfaceTheme = useSurfaceTheme();
    const primaryRef = useRef<HTMLButtonElement>(null);
    const result = play?.gameResult ?? null;
    const immediate =
        result !== null && (isSelfResignation(result, sides) || prefersReducedMotion());
    const revealed = useRevealed(result, play?.resultDialogOpen ?? false, immediate);
    if (!play || !result) return null;

    const onOpenChange = (open: boolean) => {
        if (!open) play.closeResultDialog();
    };
    // 開いたら主ボタンに合わせる（Enter で続けて指せるように）。
    const focusPrimary = (event: Event) => {
        event.preventDefault();
        primaryRef.current?.focus();
    };
    const body = <ResultDialogBody result={result} primaryRef={primaryRef} />;

    if (variant === "panel") {
        // 盤を見られるよう modal にしない。外を押すと閉じる（盤を押せば最終局面が見える）。
        return (
            <DialogPrimitive.Root open={revealed} onOpenChange={onOpenChange} modal={false}>
                <DialogPrimitive.Content
                    aria-describedby={undefined}
                    onOpenAutoFocus={focusPrimary}
                    className="absolute inset-x-0 top-0 z-20 rounded-xl border border-wafuu-border bg-background p-5 text-foreground shadow-[0_18px_40px_rgba(0,0,0,0.22)] outline-none duration-200 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-bottom-2 motion-reduce:animate-none"
                >
                    {body}
                </DialogPrimitive.Content>
            </DialogPrimitive.Root>
        );
    }
    return (
        <DialogPrimitive.Root open={revealed} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                {/* 盤の上半分（詰みの形）が見えるよう、暗くするのは薄めにする。 */}
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out motion-reduce:animate-none" />
                <DialogPrimitive.Content
                    aria-describedby={undefined}
                    onOpenAutoFocus={focusPrimary}
                    className={cn(
                        surfaceTheme,
                        "fixed inset-x-0 bottom-0 z-[51] rounded-t-2xl border-t border-wafuu-border bg-background px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-2 text-foreground shadow-[0_-12px_30px_rgba(0,0,0,0.2)] outline-none duration-300 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom motion-reduce:animate-none",
                    )}
                >
                    <div
                        aria-hidden
                        className="mx-auto mb-2 h-1 w-9 rounded-full bg-wafuu-border"
                    />
                    {body}
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

function ResultDialogBody({
    result,
    primaryRef,
}: {
    result: GameResult;
    primaryRef: RefObject<HTMLButtonElement | null>;
}): ReactElement | null {
    const { play } = useShogiMatchConfig();
    const headline = useResultHeadline(result);
    const reasonText = useReasonText(result);
    const summary = useRematchSummary();
    if (!play) return null;
    // ダイアログを閉じてから次へ進む（閉じないと、次の対局の終局で開き直せない）。
    const closeThen = (action: () => void) => () => {
        play.closeResultDialog();
        action();
    };
    const openStudy = play.openStudy;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <DialogPrimitive.Title
                        className={cn(
                            "font-display text-[28px] font-semibold leading-tight",
                            winnerColorClass(result),
                        )}
                    >
                        {headline.text}
                    </DialogPrimitive.Title>
                    <p className="text-sm font-medium text-wafuu-sumi">
                        {reasonText} ・ {result.totalMoves}手まで
                        {play.hintCount > 0 ? ` ・ ヒント ${play.hintCount} 回` : ""}
                    </p>
                </div>
                <DialogPrimitive.Close asChild>
                    <button
                        type="button"
                        className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-sm px-1 text-[13px] text-wafuu-sumi-light hover:text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        盤を見る
                        <span aria-hidden>✕</span>
                    </button>
                </DialogPrimitive.Close>
            </div>
            <div className="flex flex-col gap-1.5">
                <Button
                    ref={primaryRef}
                    type="button"
                    size="lg"
                    className={cn("h-12 w-full text-base font-semibold", PLAY_PRIMARY_BUTTON)}
                    onClick={closeThen(play.rematch)}
                >
                    もう一局
                </Button>
                {summary && <p className="text-center text-xs text-wafuu-sumi-light">{summary}</p>}
            </div>
            <div className={cn("grid gap-2", openStudy ? "grid-cols-2" : "grid-cols-1")}>
                <Button
                    type="button"
                    variant="outline"
                    className={cn(PLAY_OUTLINE_BUTTON, "h-auto min-h-11 whitespace-normal px-2")}
                    onClick={closeThen(play.newGame)}
                >
                    設定を変えて対局
                </Button>
                {openStudy && (
                    <Button
                        type="button"
                        variant="outline"
                        className={cn(
                            PLAY_OUTLINE_BUTTON,
                            "h-auto min-h-11 whitespace-normal px-2",
                        )}
                        onClick={closeThen(openStudy)}
                    >
                        研究ノートで振り返る
                    </Button>
                )}
            </div>
            <div className="flex justify-center text-[13px] text-wafuu-sumi-light">
                <CopyKifButton />
            </div>
        </div>
    );
}
