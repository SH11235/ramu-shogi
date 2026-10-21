/**
 * 時間を数で決めるダイアログ（対局の設定の「指定」から開く）。
 *
 * 時間だけを聞く。人の持ち時間は「持ち時間（分）＋ 1 手（秒）」、AI の考慮時間は「1 手（秒）」。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../../button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../dialog";
import { PLAY_OUTLINE_BUTTON, PLAY_PRIMARY_BUTTON } from "./playStyles";
import type { TimeChoice } from "./usePlaySetup";

/** 1 日。これより長い時間は対局の時計として意味がない。 */
const MAX_MINUTES = 1_440;
const MAX_SECONDS = 86_400;

const NUMBER_INPUT_CLASS =
    "h-10 w-20 rounded-md border border-wafuu-border bg-background px-2 text-right text-base tabular-nums text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * 時間を選択肢と同じ書き方で書く（「10分+30秒」「1手30秒」「5分」「1分30秒」）。
 * 詳細設定では秒単位の持ち時間も作れるので、分に丸めない。
 */
export function formatClock(mainMs: number, byoyomiMs: number): string {
    const mainSeconds = Math.round(mainMs / 1000);
    const minutes = Math.floor(mainSeconds / 60);
    const restSeconds = mainSeconds % 60;
    const mainText =
        minutes > 0
            ? restSeconds > 0
                ? `${minutes}分${restSeconds}秒`
                : `${minutes}分`
            : restSeconds > 0
              ? `${restSeconds}秒`
              : "";
    const byoyomi = Math.round(byoyomiMs / 1000);
    if (mainText && byoyomi > 0) return `${mainText}+${byoyomi}秒`;
    if (mainText) return mainText;
    // 両方 0 は時間を決めていない（無制限）のと同じなので、時間としては書かない。
    return byoyomi > 0 ? `1手${byoyomi}秒` : "指定";
}

/** このダイアログの入力（分と秒）で、そのまま書き表せる時間か。 */
export function isDialogRepresentable(
    kind: "player" | "ai",
    mainMs: number,
    byoyomiMs: number,
): boolean {
    if (kind === "ai") return mainMs === 0 && byoyomiMs >= 1000;
    return mainMs % 60_000 === 0 && (mainMs > 0 || byoyomiMs > 0);
}

interface PlayTimeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** "player": 持ち時間（分）と 1 手（秒）を聞く。"ai": 1 手（秒）だけを聞く */
    kind: "player" | "ai";
    title: string;
    mainMs: number;
    byoyomiMs: number;
    onApply: (choice: TimeChoice) => void;
}

export function PlayTimeDialog(props: PlayTimeDialogProps): ReactElement {
    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="w-[min(360px,calc(100%-24px))]">
                <DialogHeader>
                    <DialogTitle>{props.title}</DialogTitle>
                </DialogHeader>
                {/* 中身は開くたびに作り直されるので、いまの値から始まる（前に打ちかけた値を残さない）。 */}
                <PlayTimeForm {...props} />
            </DialogContent>
        </Dialog>
    );
}

function PlayTimeForm({
    onOpenChange,
    kind,
    mainMs,
    byoyomiMs,
    onApply,
}: Pick<
    PlayTimeDialogProps,
    "onOpenChange" | "kind" | "mainMs" | "byoyomiMs" | "onApply"
>): ReactElement {
    const [minutesText, setMinutesText] = useState(String(Math.floor(mainMs / 60_000)));
    const [secondsText, setSecondsText] = useState(String(Math.floor(byoyomiMs / 1000)));

    const parse = (text: string, max: number): number | null => {
        // 日本語入力のまま打った全角数字（「５」）も受け付ける。
        const trimmed = text.normalize("NFKC").trim();
        if (trimmed === "") return 0;
        if (!/^[0-9]+$/.test(trimmed)) return null;
        const value = Number(trimmed);
        if (!Number.isInteger(value) || value < 0 || value > max) return null;
        return value;
    };
    const minutes = kind === "player" ? parse(minutesText, MAX_MINUTES) : 0;
    const seconds = parse(secondsText, MAX_SECONDS);
    const error =
        minutes === null || seconds === null
            ? "0 以上の整数で入れてください"
            : kind === "ai" && seconds === 0
              ? "1 秒以上にしてください"
              : minutes === 0 && seconds === 0
                ? "時間を決めないときは「無制限」を選んでください"
                : null;

    const apply = () => {
        if (error !== null || minutes === null || seconds === null) return;
        onApply({
            id: "custom",
            label: formatClock(minutes * 60_000, seconds * 1000),
            mainMs: minutes * 60_000,
            byoyomiMs: seconds * 1000,
            enabled: true,
        });
        onOpenChange(false);
    };

    return (
        <form
            className="flex flex-col gap-4 pt-2"
            onSubmit={(event) => {
                event.preventDefault();
                apply();
            }}
        >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-sm text-wafuu-sumi">
                {kind === "player" && (
                    <label className="flex items-center gap-1.5">
                        持ち時間
                        <input
                            type="text"
                            inputMode="numeric"
                            value={minutesText}
                            onChange={(event) => setMinutesText(event.target.value)}
                            className={NUMBER_INPUT_CLASS}
                        />
                        分
                    </label>
                )}
                <label className="flex items-center gap-1.5">
                    {kind === "player" ? "＋ 1手" : "1手"}
                    <input
                        type="text"
                        inputMode="numeric"
                        value={secondsText}
                        onChange={(event) => setSecondsText(event.target.value)}
                        className={NUMBER_INPUT_CLASS}
                    />
                    秒
                </label>
            </div>
            <p
                role={error ? "alert" : undefined}
                className={cn(
                    "min-h-5 text-xs",
                    error ? "text-destructive" : "text-wafuu-sumi-light",
                )}
            >
                {error ??
                    (kind === "player"
                        ? "持ち時間を使い切ると、1 手ごとに秒読みになります。"
                        : "AI は 1 手ごとにこの時間まで考えます。")}
            </p>
            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="outline"
                    className={cn("flex-1", PLAY_OUTLINE_BUTTON)}
                    onClick={() => onOpenChange(false)}
                >
                    やめる
                </Button>
                <Button
                    type="submit"
                    disabled={error !== null}
                    className={cn("h-10 flex-1 font-semibold", PLAY_PRIMARY_BUTTON)}
                >
                    この時間にする
                </Button>
            </div>
        </form>
    );
}
