/**
 * 対局画面のヒントの読み。
 *
 * 再開できる解析（Web の wasm エンジンの協調停止）が使えるときは、止めても読みの状態（置換表・深さ）を
 * 残し、「続けて読む」でその続きから読む。使えないとき（Desktop のネイティブエンジン、共有メモリの無い
 * ブラウザ、パス権のある対局）は、上限まで 1 回読むだけにする（続きは無いので「続けて読む」を出さない）。
 */

import type { InteractiveAnalysisState } from "@shogi/app-controller";
import { createAnalysisController } from "@shogi/app-controller";
import type { NnueSelection, ResolvedNnue } from "@shogi/app-core";
import type { EngineInfoEvent } from "@shogi/engine-client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { EngineOption } from "../types";
import { HINT_SEARCH_MAX_DEPTH, HINT_SEARCH_TIME_MS } from "../utils/hintSettings";
import type { HintSearchOptions } from "./useBatchAnalysis";
import type { RecordedEvalInfoEvent } from "./useKifuNavigation";

export type HintSearchPhase = "idle" | "preparing" | "searching" | "stopped";

export interface PlayHintSearchStatus {
    /** ヒントを求めた手数。求めていなければ null */
    ply: number | null;
    /**
     * ヒントを求めた局面（開始局面と指し手）。待ったで戻って別の手順で同じ手数に来ても、
     * 前の局面のヒントを出さないよう、手数ではなくこれで照らし合わせる
     */
    positionKey: string | null;
    phase: HintSearchPhase;
    /** 止めた・上限まで読んだあと、同じ局面の続きから読める */
    canContinue: boolean;
    /** 読んだ時間の合計（続けて読んだ分も足す）を数えるための、仮の読み始めの時刻と、止めた時刻 */
    startedAt: number | null;
    endedAt: number | null;
    /** 読んだ局面数の合計（取れたときだけ） */
    nodes: number | null;
}

interface UsePlayHintSearchOptions {
    /** 対局画面か（ほかの画面ではヒントの読みを作らない） */
    enabled: boolean;
    engineOption: EngineOption | undefined;
    threads: number;
    multiPv: number;
    nnueSelection: NnueSelection;
    resolveNnue: (selection: NnueSelection) => Promise<ResolvedNnue | null>;
    startSfen: string;
    /** いまの局面までの指し手 */
    moves: string[];
    currentPly: number;
    /** パス権のある対局（再開できる解析にパス権を渡せないので、1 回読むだけにする） */
    usesPassRights: boolean;
    /** 対局が進んでいる（一時停止・終局していない） */
    matchActive: boolean;
    recordEvalByPly: (ply: number, event: RecordedEvalInfoEvent) => void;
    clearEvalByPly: (ply: number) => void;
    /** 再開できる解析が使えないときの、1 回だけの読み */
    fallback: {
        analyze: (ply: number, options: HintSearchOptions) => Promise<boolean>;
        cancel: () => Promise<void>;
        isAnalyzing: boolean;
    };
}

interface PlayHintSearch {
    status: PlayHintSearchStatus;
    request: () => void;
    stop: () => void;
    resume: () => void;
    /** 新しい対局のとき。読みを止め、結果の印を消す */
    reset: () => void;
}

export const hintPositionKey = (startSfen: string, moves: readonly string[]): string =>
    [startSfen, ...moves].join(" ");

const IDLE: PlayHintSearchStatus = {
    ply: null,
    positionKey: null,
    phase: "idle",
    canContinue: false,
    startedAt: null,
    endedAt: null,
    nodes: null,
};

const BUDGET = { type: "time", milliseconds: HINT_SEARCH_TIME_MS } as const;

export function usePlayHintSearch(options: UsePlayHintSearchOptions): PlayHintSearch {
    const [status, setStatus] = useState<PlayHintSearchStatus>(IDLE);
    const controllerRef = useRef<ReturnType<typeof createAnalysisController> | null>(null);
    /** 再開できる解析が使えないと分かった（以後は 1 回読むだけにする） */
    const unsupportedRef = useRef(false);
    /** 止めるまでの 1 回の読みで、それまでの読みに足す局面数 */
    const baseNodesRef = useRef(0);
    /** 1 回だけの読みの要求ごとに進める（止めた要求を、準備のあとで始めない） */
    const fallbackRequestRef = useRef(0);
    const usingFallbackRef = useRef(false);

    const settingsKey = JSON.stringify([
        options.engineOption?.id,
        options.threads,
        options.multiPv,
        options.nnueSelection,
    ]);

    const onControllerState = useEffectEvent((state: InteractiveAnalysisState) => {
        if (state.phase === "unsupported") {
            unsupportedRef.current = true;
            return;
        }
        setStatus((prev) => {
            if (prev.ply === null || usingFallbackRef.current) return prev;
            const searching = state.phase === "running" || state.phase === "stopping";
            const phase: HintSearchPhase =
                state.phase === "preparing" ? "preparing" : searching ? "searching" : "stopped";
            if (prev.phase === phase && prev.canContinue === state.canResume) return prev;
            return {
                ...prev,
                phase,
                canContinue: state.canResume,
                endedAt: phase === "stopped" ? (prev.endedAt ?? Date.now()) : null,
            };
        });
    });
    const onControllerInfo = useEffectEvent((info: EngineInfoEvent) => {
        if (status.ply === null) return;
        if (info.scoreCp !== undefined || info.scoreMate !== undefined) {
            options.recordEvalByPly(status.ply, info);
        }
        if (info.nodes !== undefined) {
            const nodes = baseNodesRef.current + info.nodes;
            setStatus((prev) => (prev.nodes === nodes ? prev : { ...prev, nodes }));
        }
    });

    // 再開できる解析を試すのは、ヒント専用にエンジンを 1 つ作れるときだけ。外部 USI エンジンは再開できず、
    // Desktop の内蔵エンジン（maxParallel 1）は全クライアントが共有するので、別に作ると対局のエンジンを乱す。
    const canHostResumable =
        options.engineOption !== undefined &&
        options.engineOption.kind !== "external" &&
        options.engineOption.maxParallel !== 1;

    // 設定（エンジン・スレッド・候補数・評価関数）は解析の準備で 1 度だけ当てるので、変わったら作り直す。
    // biome-ignore lint/correctness/useExhaustiveDependencies: settingsKey が設定の変化を表す
    useEffect(() => {
        if (!options.enabled || !options.engineOption || !canHostResumable) return;
        const engineOption = options.engineOption;
        const controller = createAnalysisController({
            createClient: () => engineOption.createClient(),
            prepare: async (client) => {
                await client.init({ threads: options.threads });
                const selection = options.nnueSelection;
                if ((selection.presetKey || selection.nnueId) && client.loadNnue) {
                    const resolved = await options.resolveNnue(selection);
                    if (resolved) {
                        await client.loadNnue(resolved.nnueId, resolved.layerStacks);
                        await client.setOption("FV_SCALE", resolved.fvScale);
                    }
                }
                await client.setOption("MultiPV", String(options.multiPv));
            },
            onState: (state) => onControllerState(state),
            onInfo: (_target, _sessionId, info) => onControllerInfo(info),
            onFinished: (_target, result) => {
                baseNodesRef.current = result.totalNodes;
                setStatus((prev) =>
                    prev.ply === null ? prev : { ...prev, nodes: result.totalNodes },
                );
            },
        });
        controllerRef.current = controller;
        unsupportedRef.current = false;
        return () => {
            controllerRef.current = null;
            void controller.dispose();
        };
    }, [options.enabled, settingsKey, canHostResumable]);

    const startFallback = (ply: number) => {
        usingFallbackRef.current = true;
        const requestId = ++fallbackRequestRef.current;
        void options.fallback
            .analyze(ply, {
                multiPv: options.multiPv,
                timeMs: HINT_SEARCH_TIME_MS,
                depth: HINT_SEARCH_MAX_DEPTH,
                shouldStart: () => fallbackRequestRef.current === requestId,
            })
            .then((started) => {
                if (started || fallbackRequestRef.current !== requestId) return;
                setStatus((prev) => ({ ...prev, phase: "stopped", endedAt: Date.now() }));
            });
    };

    // 1 回だけの読みは、解析中かどうかで状態を決める（読み終えたら止まる。続きは無い）。
    const wasFallbackAnalyzingRef = useRef(false);
    useEffect(() => {
        if (!usingFallbackRef.current) return;
        const was = wasFallbackAnalyzingRef.current;
        wasFallbackAnalyzingRef.current = options.fallback.isAnalyzing;
        if (options.fallback.isAnalyzing) {
            setStatus((prev) =>
                prev.phase === "searching" ? prev : { ...prev, phase: "searching" },
            );
        } else if (was) {
            setStatus((prev) =>
                prev.phase === "stopped"
                    ? prev
                    : { ...prev, phase: "stopped", endedAt: Date.now() },
            );
        }
    }, [options.fallback.isAnalyzing]);

    const stop = () => {
        if (usingFallbackRef.current) {
            fallbackRequestRef.current += 1;
            void options.fallback.cancel();
            setStatus((prev) =>
                prev.ply === null ? prev : { ...prev, phase: "stopped", endedAt: Date.now() },
            );
            return;
        }
        void controllerRef.current?.pause();
    };

    // その局面を離れた・対局が止まったら、読みを止める（AI の手番に探索スレッドを取り合わない）。
    const stopEvent = useEffectEvent(stop);
    useEffect(() => {
        if (status.ply === null) return;
        if (status.phase !== "preparing" && status.phase !== "searching") return;
        if (options.currentPly === status.ply && options.matchActive) return;
        stopEvent();
    }, [options.currentPly, options.matchActive, status.ply, status.phase]);

    const begin = (resume: boolean) => {
        const ply = options.currentPly;
        const positionKey = hintPositionKey(options.startSfen, options.moves);
        const controller = controllerRef.current;
        const now = Date.now();
        setStatus((prev) => ({
            ply,
            positionKey,
            phase: "preparing",
            canContinue: false,
            // 続けて読むときは、前の読みの時間から数え続ける（同じ読みの続きなので）。
            startedAt:
                resume && prev.startedAt !== null && prev.endedAt !== null
                    ? now - (prev.endedAt - prev.startedAt)
                    : now,
            endedAt: null,
            nodes: resume ? prev.nodes : null,
        }));
        if (!resume) {
            baseNodesRef.current = 0;
            options.clearEvalByPly(ply);
        }
        const canResumeHere = !options.usesPassRights && !unsupportedRef.current && controller;
        if (!canResumeHere) {
            startFallback(ply);
            return;
        }
        usingFallbackRef.current = false;
        void controller
            .select({ nodeId: positionKey, sfen: options.startSfen, moves: options.moves })
            .then(() => controller.start(BUDGET))
            .then(() => {
                // 準備の途中で「再開できない」と分かったら、その場で 1 回だけの読みに切り替える。
                if (unsupportedRef.current && controllerRef.current === controller) {
                    startFallback(ply);
                }
            });
    };

    return {
        status,
        request: () => begin(false),
        stop,
        resume: () => {
            const here = hintPositionKey(options.startSfen, options.moves);
            if (!status.canContinue || status.positionKey !== here) return;
            begin(true);
        },
        reset: () => {
            stop();
            fallbackRequestRef.current += 1;
            baseNodesRef.current = 0;
            setStatus(IDLE);
        },
    };
}
