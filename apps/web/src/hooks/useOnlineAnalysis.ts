import type { LayerStacksOptions } from "@shogi/engine-client";
import type { AnalysisMoveResult, OnlineAnalysis } from "@shogi/ui";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createWebWasmEngineClient } from "../platform/wasm-engine-client";

export function useOnlineAnalysis(
    searchDepth: number | null,
    searchTimeMs: number | null,
    passRights?: { initialCount: number } | null,
): OnlineAnalysis {
    const engineRef = useRef<ReturnType<typeof createWebWasmEngineClient> | null>(null);
    const searchHandleRef = useRef<{ cancel(): Promise<void> } | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);
    const mountedRef = useRef(false);
    const initializedRef = useRef(false);
    const selectedNnueRef = useRef<{ nnueId: string; layerStacks?: LayerStacksOptions } | null>(
        null,
    );
    const loadedNnueRef = useRef<typeof selectedNnueRef.current>(null);
    const generationRef = useRef(0);
    const operationsRef = useRef<Promise<unknown>>(Promise.resolve());
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [topMoves, setTopMoves] = useState<AnalysisMoveResult[]>([]);
    const topMovesMapRef = useRef<Map<number, AnalysisMoveResult>>(new Map());

    const withEngineOperation = (operation: () => Promise<void>) => {
        const run = operationsRef.current.then(operation);
        operationsRef.current = run.catch(() => undefined);
        return run;
    };

    const invalidateAnalysis = () => {
        generationRef.current += 1;
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        setIsAnalyzing(false);
        return generationRef.current;
    };

    const cancelActiveSearch = async () => {
        const handle = searchHandleRef.current;
        searchHandleRef.current = null;
        await handle?.cancel().catch(() => undefined);
    };

    const disposeEngine = async () => {
        const engine = engineRef.current;
        engineRef.current = null;
        initializedRef.current = false;
        loadedNnueRef.current = null;
        searchHandleRef.current = null;
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        await engine?.dispose().catch(console.error);
    };

    const prepareEngine = async (isCurrent: () => boolean) => {
        if (!isCurrent()) return null;
        const engine = engineRef.current ?? createWebWasmEngineClient();
        engineRef.current = engine;
        if (!initializedRef.current) {
            await engine.init();
            if (!isCurrent()) return null;
            await engine.setOption("MultiPV", 3);
            if (!isCurrent()) return null;
            initializedRef.current = true;
        }
        const selected = selectedNnueRef.current;
        if (selected && loadedNnueRef.current !== selected) {
            await engine.loadNnue?.(selected.nnueId, selected.layerStacks);
            if (!isCurrent()) return null;
            loadedNnueRef.current = selected;
        }
        return engine;
    };

    const teardown = useEffectEvent(() => {
        mountedRef.current = false;
        generationRef.current += 1;
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
        void withEngineOperation(disposeEngine);
    });

    useEffect(() => {
        mountedRef.current = true;
        return () => teardown();
    }, []);

    const startAnalysis = async (sfen: string, moves: string[]): Promise<void> => {
        if (!mountedRef.current) return;
        const generation = invalidateAnalysis();
        const isCurrent = () => mountedRef.current && generationRef.current === generation;

        topMovesMapRef.current.clear();
        setTopMoves([]);
        setIsAnalyzing(true);

        await withEngineOperation(async () => {
            if (!isCurrent()) return;
            try {
                await cancelActiveSearch();
                const engine = await prepareEngine(isCurrent);
                if (!engine || !isCurrent()) return;
                let ended = false;
                const unsub = engine.subscribe((event) => {
                    if (!isCurrent()) return;
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
                        ended = true;
                        setIsAnalyzing(false);
                        searchHandleRef.current = null;
                        unsub();
                        unsubscribeRef.current = null;
                    }
                });
                unsubscribeRef.current = unsub;

                const passRightsOption = passRights
                    ? {
                          passRights: {
                              sente: passRights.initialCount,
                              gote: passRights.initialCount,
                          },
                      }
                    : undefined;
                await engine.loadPosition(sfen, moves, passRightsOption);
                if (!isCurrent()) return;
                const limits: { maxDepth?: number; movetimeMs?: number } = {};
                if (searchDepth !== null) limits.maxDepth = searchDepth;
                if (searchTimeMs !== null) limits.movetimeMs = searchTimeMs;
                const handle = await engine.search({ limits });
                if (!isCurrent() || !ended) searchHandleRef.current = handle;
            } catch {
                if (isCurrent()) invalidateAnalysis();
            } finally {
                if (!isCurrent()) await disposeEngine();
            }
        });
    };

    const cancelAnalysis = async (): Promise<void> => {
        invalidateAnalysis();
        await withEngineOperation(cancelActiveSearch);
    };

    const loadNnue = async (
        nnueId: string | null,
        layerStacks?: LayerStacksOptions,
    ): Promise<void> => {
        if (!mountedRef.current || !nnueId) return;
        selectedNnueRef.current = { nnueId, layerStacks };
        const generation = invalidateAnalysis();
        const isCurrent = () => mountedRef.current && generationRef.current === generation;
        await withEngineOperation(async () => {
            if (!isCurrent()) return;
            try {
                await cancelActiveSearch();
                await prepareEngine(isCurrent);
            } catch (error) {
                if (!isCurrent()) return;
                invalidateAnalysis();
                throw error;
            } finally {
                if (!isCurrent()) await disposeEngine();
            }
        });
    };

    return { isAnalyzing, topMoves, startAnalysis, cancelAnalysis, loadNnue };
}
