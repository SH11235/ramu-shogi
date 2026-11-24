import type { KifuNode, StudyHighlightKind } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { formatEval } from "../shogi-match/utils/kifFormat";

export const STUDY_KIND_BADGE: Record<StudyHighlightKind, { label: string; className: string }> = {
    blunder: {
        label: "悪手",
        className: "border-study-blunder-border bg-study-blunder-bg text-study-blunder",
    },
    dubious: {
        label: "疑問手",
        className: "border-study-dubious-border bg-study-dubious-bg text-study-dubious",
    },
};

/**
 * スマートフォンで局面の移動の下に出す、いまの局面の 1 行（手・解析の評価値・悪手かどうか）。
 * どの表示でも同じ位置・同じ高さに出す（候補手や棋譜を開いていても、いまどこにいるかが分かるように）。
 */
export function StudyPositionBand({
    node,
    ply,
    moveLabel,
    kind,
}: {
    node: KifuNode;
    /** 表示中の手順での位置。 */
    ply: number;
    moveLabel: string;
    kind: StudyHighlightKind | undefined;
}): ReactElement {
    const evalText = formatEval(node.eval?.scoreCp, node.eval?.scoreMate);
    const evalValue = node.eval?.scoreMate ?? node.eval?.scoreCp ?? 0;
    return (
        <output
            aria-label="いまの局面"
            className="flex h-8 items-center gap-2 rounded-lg border border-wafuu-border bg-wafuu-washi-warm px-2.5 text-sm"
        >
            <span className="shrink-0 tabular-nums text-muted-foreground">
                {ply === 0 ? "開始局面" : `${ply}手目`}
            </span>
            {ply > 0 && <span className="min-w-0 truncate text-wafuu-sumi">{moveLabel}</span>}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {kind && (
                    <span
                        className={cn(
                            "rounded border px-1 text-xs font-medium",
                            STUDY_KIND_BADGE[kind].className,
                        )}
                    >
                        {STUDY_KIND_BADGE[kind].label}
                    </span>
                )}
                <span
                    className={cn(
                        "min-w-[5ch] text-right font-mono tabular-nums",
                        evalText === ""
                            ? "text-muted-foreground"
                            : evalValue > 0
                              ? "text-wafuu-shu"
                              : evalValue < 0
                                ? "text-wafuu-ai"
                                : "text-foreground",
                    )}
                >
                    {evalText || "—"}
                </span>
            </span>
        </output>
    );
}
