/**
 * 時間を数で決めるダイアログ（対局の設定の「指定」から開く）。
 *
 * 時間だけを聞く。持ち時間（分）と、使い切ったあとの決まり（秒読み／1 手ごとの加算）の秒数。
 * 人も AI も同じ形で決める。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../../button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../dialog";
import { formatTimeRule } from "../utils/timeSettings";
import { PLAY_OUTLINE_BUTTON, PLAY_PRIMARY_BUTTON } from "./playStyles";
import type { TimeChoice } from "./usePlaySetup";

/** 1 日。これより長い時間は対局の時計として意味がない。 */
const MAX_MINUTES = 1_440;
const MAX_SECONDS = 86_400;

const NUMBER_INPUT_CLASS =
    "h-10 w-20 rounded-md border border-wafuu-border bg-background px-2 text-right text-base tabular-nums text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type RuleMode = "byoyomi" | "increment";

const RULE_OPTIONS: Array<{ id: RuleMode; title: ReactElement; description: string }> = [
    {
        id: "byoyomi",
        title: <>秒読み</>,
        description: "持ち時間を使い切ったら、1 手ごとに決まった秒数で指す",
    },
    {
        id: "increment",
        title: (
            <>
                1 手ごとに加算
                <span className="font-normal text-wafuu-sumi-light">（フィッシャー方式）</span>
            </>
        ),
        description: "1 手指すごとに持ち時間が増える。秒読みはない",
    },
];

/** このダイアログの入力（分と秒、秒読みか加算のどちらか一方）で、そのまま書き表せる時間か。 */
export function isDialogRepresentable(clock: {
    mainMs: number;
    byoyomiMs: number;
    incrementMs: number;
}): boolean {
    if (clock.mainMs % 60_000 !== 0) return false;
    if (clock.byoyomiMs > 0 && clock.incrementMs > 0) return false;
    if (clock.incrementMs > 0) return clock.mainMs > 0 && clock.incrementMs % 1000 === 0;
    return clock.byoyomiMs % 1000 === 0 && (clock.mainMs > 0 || clock.byoyomiMs > 0);
}

interface PlayTimeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** "ai" は時間を決めずには指せないので、持ち時間も秒も 0 にはできない。書き方も「1手○秒」にする */
    kind: "player" | "ai";
    title: string;
    mainMs: number;
    byoyomiMs: number;
    incrementMs: number;
    onApply: (choice: TimeChoice) => void;
}

export function PlayTimeDialog(props: PlayTimeDialogProps): ReactElement {
    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="w-[min(380px,calc(100%-24px))]">
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
    incrementMs,
    onApply,
}: Omit<PlayTimeDialogProps, "open" | "title">): ReactElement {
    const [mode, setMode] = useState<RuleMode>(incrementMs > 0 ? "increment" : "byoyomi");
    const [minutesText, setMinutesText] = useState(String(Math.floor(mainMs / 60_000)));
    const [secondsText, setSecondsText] = useState(
        String(Math.floor((incrementMs > 0 ? incrementMs : byoyomiMs) / 1000)),
    );

    const parse = (text: string, max: number): number | null => {
        // 日本語入力のまま打った全角数字（「５」）も受け付ける。
        const trimmed = text.normalize("NFKC").trim();
        if (trimmed === "") return 0;
        if (!/^[0-9]+$/.test(trimmed)) return null;
        const value = Number(trimmed);
        if (!Number.isInteger(value) || value < 0 || value > max) return null;
        return value;
    };
    const minutes = parse(minutesText, MAX_MINUTES);
    const seconds = parse(secondsText, MAX_SECONDS);
    const isIncrement = mode === "increment";
    const error =
        minutes === null || seconds === null
            ? "0 以上の整数で入れてください"
            : isIncrement && minutes === 0
              ? "加算では、持ち時間を 1 分以上にしてください"
              : isIncrement && seconds === 0
                ? "加算する秒数を 1 秒以上にしてください"
                : minutes === 0 && seconds === 0
                  ? kind === "ai"
                      ? "1 秒以上にしてください"
                      : "時間を決めないときは「無制限」を選んでください"
                  : null;
    const clock =
        minutes === null || seconds === null
            ? null
            : {
                  mainMs: minutes * 60_000,
                  byoyomiMs: isIncrement ? 0 : seconds * 1000,
                  incrementMs: isIncrement ? seconds * 1000 : 0,
              };
    // 入れた数で言い直す（決まりの名前だけでは、初めての人に伝わらない）。
    const help =
        error ??
        (isIncrement
            ? `${minutes} 分から始まり、1 手指すたびに ${seconds} 秒増えます。持ち時間が 0 になったら負けです。`
            : minutes === 0
              ? `毎手 ${seconds} 秒以内に指します。`
              : seconds === 0
                ? `${minutes} 分を使い切ったら負けです（切れ負け）。`
                : `${minutes} 分を使い切ったら、そこからは 1 手 ${seconds} 秒以内に指します。`);

    const apply = () => {
        if (error !== null || clock === null) return;
        onApply({
            id: "custom",
            label: formatTimeRule(clock, { perMove: kind === "ai" }),
            ...clock,
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
            <fieldset className="flex flex-col gap-1.5">
                <legend className="sr-only">持ち時間を使い切ったあとの決まり</legend>
                {RULE_OPTIONS.map((option) => {
                    const selected = option.id === mode;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setMode(option.id)}
                            className={cn(
                                "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                selected
                                    ? "border-wafuu-sumi bg-wafuu-washi-warm ring-1 ring-inset ring-wafuu-sumi"
                                    : "border-wafuu-border bg-background hover:bg-wafuu-washi-warm",
                            )}
                        >
                            <span className="text-sm font-semibold text-wafuu-sumi">
                                {option.title}
                            </span>
                            <span className="text-xs text-wafuu-sumi-light">
                                {option.description}
                            </span>
                        </button>
                    );
                })}
            </fieldset>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-sm text-wafuu-sumi">
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
                <label className="flex items-center gap-1.5">
                    {isIncrement ? "1手ごとに +" : "秒読み"}
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
                    "min-h-10 text-xs leading-relaxed",
                    error ? "text-destructive" : "text-wafuu-sumi-light",
                )}
            >
                {help}
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
