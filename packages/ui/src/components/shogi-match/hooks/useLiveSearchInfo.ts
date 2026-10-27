import { accumulateSearchStats } from "@shogi/app-controller";
import type { MoveSearchStats, Player } from "@shogi/app-core";
import type { EngineInfoEvent } from "@shogi/engine-client";
import { useEffect, useRef, useState } from "react";

interface LiveSearchInfo {
    side: Player;
    event: EngineInfoEvent;
}

// effect からも呼ぶので、依存に入れずに済むよう ref と setState を引数に取るモジュール関数にする。
const clearDisplay = (
    trailingRef: { current: unknown },
    timerRef: { current: ReturnType<typeof setTimeout> | null },
    setLiveSearchInfo: (value: null) => void,
): void => {
    trailingRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setLiveSearchInfo(null);
};

/**
 * 対局中の AI の読み（「思考中」の帯）と、AI が指した手の探索結果（棋譜に移すまで手数ごとに控える）。
 * 対局が止まったら（終局・一時停止・エラー）、残った表示と棋譜に移していない探索結果を捨てる。
 */
export function useLiveSearchInfo({ isMatchRunning }: { isMatchRunning: boolean }) {
    const pendingSearchStatsRef = useRef(new Map<number, MoveSearchStats>());
    const [liveSearchInfo, setLiveSearchInfo] = useState<LiveSearchInfo | null>(null);
    const liveInfoTrailingRef = useRef<LiveSearchInfo | null>(null);
    const liveInfoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearLiveSearchDisplay = () =>
        clearDisplay(liveInfoTrailingRef, liveInfoTimerRef, setLiveSearchInfo);

    useEffect(
        () => () => {
            if (liveInfoTimerRef.current) clearTimeout(liveInfoTimerRef.current);
        },
        [],
    );
    // 終局・一時停止・エラーで対局が止まったとき「思考中」の残留表示と未消費の統計を消す
    useEffect(() => {
        if (isMatchRunning) return;
        pendingSearchStatsRef.current.clear();
        clearDisplay(liveInfoTrailingRef, liveInfoTimerRef, setLiveSearchInfo);
    }, [isMatchRunning]);

    return {
        liveSearchInfo,
        clearLiveSearchDisplay,
        /** bestmove を返した時点の手数で、その探索の結果を控える。 */
        recordSearchComplete: (ply: number, stats: MoveSearchStats) => {
            pendingSearchStatsRef.current.set(ply, stats);
            clearLiveSearchDisplay();
        },
        getPendingSearchStats: (ply: number) => pendingSearchStatsRef.current.get(ply),
        deletePendingSearchStats: (ply: number) => {
            pendingSearchStatsRef.current.delete(ply);
        },
        pushLiveInfo: (side: Player, event: EngineInfoEvent) => {
            // 同じ探索の info を積み上げてから出す（深さの無い info や MultiPV の 2 本目以降が最後に来ても、
            // 帯の読みが消えたり別の候補の値になったりしないように）。探索が終わると積み上げは捨てる。
            const previous = liveInfoTrailingRef.current;
            const accumulated = accumulateSearchStats(
                previous?.side === side ? (previous.event as MoveSearchStats) : {},
                event,
            );
            liveInfoTrailingRef.current = { side, event: { ...accumulated, type: "info" } };
            if (liveInfoTimerRef.current) return;
            liveInfoTimerRef.current = setTimeout(() => {
                if (liveInfoTrailingRef.current) setLiveSearchInfo(liveInfoTrailingRef.current);
                liveInfoTimerRef.current = null;
            }, 250);
        },
    };
}
