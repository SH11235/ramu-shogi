import type { Player } from "@shogi/app-core";
import type { EngineInfoEvent } from "@shogi/engine-client";
import type { ReactElement } from "react";
import { useState } from "react";
import { BottomSheet } from "./BottomSheet";

interface SearchInfoPanelProps {
    side: Player;
    info: EngineInfoEvent;
    /** モバイルは通常フローの要約とタップで開く詳細を表示する。 */
    isMobile?: boolean;
}

const formatCount = (value: number | undefined): string => {
    if (value === undefined) return "-";
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return String(value);
};

const formatScore = (info: EngineInfoEvent): string => {
    if (info.scoreMate !== undefined) return `詰 ${info.scoreMate}`;
    if (info.scoreCp !== undefined) return `${info.scoreCp >= 0 ? "+" : ""}${info.scoreCp}`;
    return "-";
};

export function SearchInfoPanel({
    side,
    info,
    isMobile = false,
}: SearchInfoPanelProps): ReactElement {
    const [detailsOpen, setDetailsOpen] = useState(false);
    const depth =
        info.depth === undefined
            ? "-"
            : info.seldepth === undefined
              ? String(info.depth)
              : `${info.depth}/${info.seldepth}`;
    const details = (
        <div className="text-xs">
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono tabular-nums">
                <span>{side === "sente" ? "▲" : "△"} 思考中</span>
                <span>深さ {depth}</span>
                <span>評価 {formatScore(info)}</span>
                <span>nodes {formatCount(info.nodes)}</span>
                <span>NPS {formatCount(info.nps)}</span>
                <span>
                    時間 {info.timeMs === undefined ? "-" : `${(info.timeMs / 1000).toFixed(1)}秒`}
                </span>
                <span>hash {info.hashfull === undefined ? "-" : `${info.hashfull}‰`}</span>
            </div>
            {info.pv && info.pv.length > 0 && (
                <div className="truncate pt-1 text-muted-foreground">
                    PV {info.pv.slice(0, 8).join(" ")}
                </div>
            )}
        </div>
    );
    if (isMobile) {
        return (
            <>
                <button
                    type="button"
                    className="flex min-h-10 w-full flex-wrap items-center justify-between gap-x-2 rounded-lg border border-border bg-card px-2 py-1 text-xs tabular-nums"
                    onClick={() => setDetailsOpen(true)}
                    aria-label="探索情報の詳細"
                >
                    <span>{side === "sente" ? "▲" : "△"} 思考中</span>
                    <span>NPS {formatCount(info.nps)}</span>
                    <span>深さ {info.depth ?? "-"}</span>
                    <span>詳細</span>
                </button>
                <BottomSheet open={detailsOpen} onOpenChange={setDetailsOpen} title="探索情報">
                    {details}
                </BottomSheet>
            </>
        );
    }
    return (
        <aside className="fixed bottom-3 left-1/2 z-40 w-[min(44rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-border bg-card/95 p-2 text-foreground shadow-lg">
            {details}
        </aside>
    );
}
