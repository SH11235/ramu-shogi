import { createWasmEngineClient } from "@shogi/engine-wasm";
import type { AnalysisMoveResult, OnlineAnalysis } from "@shogi/ui";
import { useEffect, useRef, useState } from "react";

export function useOnlineAnalysis(
    searchDepth: number | null,
    searchTimeMs: number | null,
): OnlineAnalysis {
    const engineRef = useRef<ReturnType<typeof createWasmEngineClient> | null>(null);
    const searchHandleRef = useRef<{ cancel(): Promise<void> } | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [topMoves, setTopMoves] = useState<AnalysisMoveResult[]>([]);
    const topMovesMapRef = useRef<Map<number, AnalysisMoveResult>>(new Map());

    useEffect(() => {
        const engine = createWasmEngineClient({ stopMode: "terminate" });
        engineRef.current = engine;
        engine
            .init({ threads: 1 })
            .then(() => engine.setOption("MultiPV", 3))
            .catch(console.error);
        return () => {
            engine.dispose().catch(console.error);
        };
    }, []);

    const startAnalysis = async (sfen: string, moves: string[]): Promise<void> => {
        const engine = engineRef.current;
        if (!engine) return;

        // 前回の解析をキャンセル
        if (searchHandleRef.current) {
            await searchHandleRef.current.cancel().catch(() => undefined);
            searchHandleRef.current = null;
        }
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
        }

        topMovesMapRef.current.clear();
        setTopMoves([]);
        setIsAnalyzing(true);

        const unsub = engine.subscribe((event) => {
            if (event.type === "info") {
                const ev = event as typeof event & {
                    multipv?: number;
                    pv?: string[];
                    scoreCp?: number;
                };
                const lineIdx = ev.multipv ?? 1;
                const pv = ev.pv;
                if (!pv || pv.length === 0) return;
                const cp = ev.scoreCp ?? 0;
                topMovesMapRef.current.set(lineIdx, { usi: pv[0], cp, pv });
                const sorted = Array.from(topMovesMapRef.current.entries())
                    .sort(([a], [b]) => a - b)
                    .map(([, v]) => v);
                setTopMoves(sorted);
            } else if (event.type === "bestmove") {
                setIsAnalyzing(false);
                unsub();
                unsubscribeRef.current = null;
            }
        });
        unsubscribeRef.current = unsub;

        try {
            await engine.loadPosition(sfen, moves);
            const limits: { maxDepth?: number; movetimeMs?: number } = {};
            if (searchDepth !== null) limits.maxDepth = searchDepth;
            if (searchTimeMs !== null) limits.movetimeMs = searchTimeMs;
            const handle = await engine.search({ limits });
            searchHandleRef.current = handle;
        } catch {
            setIsAnalyzing(false);
            unsub();
            unsubscribeRef.current = null;
        }
    };

    const cancelAnalysis = async (): Promise<void> => {
        if (searchHandleRef.current) {
            await searchHandleRef.current.cancel().catch(() => undefined);
            searchHandleRef.current = null;
        }
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
        }
        setIsAnalyzing(false);
    };

    const loadNnue = async (nnueId: string | null): Promise<void> => {
        const engine = engineRef.current;
        if (!engine?.loadNnue) return;
        if (nnueId) await engine.loadNnue(nnueId);
    };

    return { isAnalyzing, topMoves, startAnalysis, cancelAnalysis, loadNnue };
}
