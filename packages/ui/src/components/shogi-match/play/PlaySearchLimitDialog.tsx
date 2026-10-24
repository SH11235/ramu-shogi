/**
 * AI が 1 手に読む量を数で決めるダイアログ（考慮時間の欄の「ノード数で指定…」「深さで指定…」から開く）。
 *
 * 数だけを聞く。読み終えるまで待つので、その AI の側は時間を使わない（時間切れにならない）。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../../button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../dialog";
import type { EngineSearchLimit } from "../types";
import {
    formatNodeCount,
    formatSearchLimit,
    parseSearchLimitInput,
    SEARCH_LIMIT_DEFAULTS,
    type SearchLimitKind,
} from "../utils/searchLimits";
import { PLAY_OUTLINE_BUTTON, PLAY_PRIMARY_BUTTON } from "./playStyles";

const NUMBER_INPUT_CLASS =
    "h-10 w-36 rounded-md border border-wafuu-border bg-background px-2 text-right text-base tabular-nums text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface PlaySearchLimitDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kind: SearchLimitKind;
    title: string;
    /** いまの読む量（同じ種類なら、その数から始める） */
    current: EngineSearchLimit;
    onApply: (limit: EngineSearchLimit) => void;
}

export function PlaySearchLimitDialog(props: PlaySearchLimitDialogProps): ReactElement {
    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="w-[min(380px,calc(100%-24px))]">
                <DialogHeader>
                    <DialogTitle>{props.title}</DialogTitle>
                </DialogHeader>
                {/* 開くたびに作り直し、いまの値から始める。 */}
                <PlaySearchLimitForm key={props.kind} {...props} />
            </DialogContent>
        </Dialog>
    );
}

function PlaySearchLimitForm({
    onOpenChange,
    kind,
    current,
    onApply,
}: Omit<PlaySearchLimitDialogProps, "open" | "title">): ReactElement {
    const initial =
        current.kind === "nodes" && kind === "nodes"
            ? current.nodes
            : current.kind === "depth" && kind === "depth"
              ? current.depth
              : SEARCH_LIMIT_DEFAULTS[kind];
    const [text, setText] = useState(String(initial));
    const { limit, error } = parseSearchLimitInput(text, kind);
    const help =
        limit === null
            ? error
            : limit.kind === "nodes"
              ? `毎手 ${formatNodeCount(limit.nodes)}局面まで読んで指します。端末の速さで考える時間が変わります。`
              : `毎手 ${formatSearchLimit(limit)} まで読んで指します。深くすると、1 手に長くかかることがあります。`;

    const apply = () => {
        if (limit === null) return;
        onApply(limit);
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
            <label className="flex items-center gap-1.5 text-sm text-wafuu-sumi">
                {kind === "nodes" ? "ノード数" : "深さ"}
                <input
                    type="text"
                    inputMode="numeric"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    className={NUMBER_INPUT_CLASS}
                />
                {kind === "nodes" && "局面"}
            </label>
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
                    この量にする
                </Button>
            </div>
        </form>
    );
}
