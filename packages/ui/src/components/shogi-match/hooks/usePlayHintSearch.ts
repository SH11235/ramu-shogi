/**
 * 対局画面のヒントの読み。
 *
 * 再開できる解析（Web の wasm エンジンの協調停止）が使えるときは、止めても読みの状態（置換表・深さ）を
 * 残し、「続けて読む」でその続きから読む。使えないとき（Desktop のネイティブエンジン、外部 USI エンジン、
 * 共有メモリの無いブラウザ）は、上限まで 1 回読むだけにする（続きは無いので「続けて読む」を出さない）。
 */

import type { InteractiveAnalysisState, PassRightsSettings } from "@shogi/app-controller";
import { buildPassRightsOption, createAnalysisController } from "@shogi/app-controller";
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
    /** パス権の設定（局面の読み込みに渡す。パス権が違えば別の局面として読む） */
    passRightsSettings: PassRightsSettings | undefined;
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
    /**
     * いまのヒントの読み。新しく求めるたびに別の id にする（同じ局面でも、前の対局や前のヒントの読みを
     * 再開しない）。「続けて読む」だけが同じ id を使う。id の違う読みからの通知は捨てる。
     */
    const sessionRef = useRef<{ nodeId: string; ply: number } | null>(null);
    const sessionSerialRef = useRef(0);
    /** 求める・止める・やり直すたびに進める。準備を待つ間に止められた要求を、あとから始めない */
    const generationRef = useRef(0);
    /** 止めるまでの 1 回の読みで、それまでの読みに足す局面数 */
    const baseNodesRef = useRef(0);
    /**
     * いまの読みの通知を受け付けるか。止めた（局面を離れた）あとは、停止が終わるまでに届く読みも捨てる
     * （待ったで別の手順から同じ手数に来たとき、その局面へ前の局面の評価を書き込まない）。
     */
    const acceptingInfoRef = useRef(false);
    const usingFallbackRef = useRef(false);

    const settingsKey = JSON.stringify([
        options.engineOption?.id,
        options.threads,
        options.multiPv,
        options.nnueSelection,
    ]);
    const isCurrentSession = (nodeId: string | undefined) =>
        nodeId !== undefined && sessionRef.current?.nodeId === nodeId;

    const onControllerState = useEffectEvent((state: InteractiveAnalysisState) => {
        if (state.phase === "unsupported") {
            unsupportedRef.current = true;
            return;
        }
        if (usingFallbackRef.current || !isCurrentSession(state.selected?.nodeId)) return;
        // 読みの状態（読んでいる・止まった）は、いまのヒントの読みを保持しているときだけ写す。
        // 新しく求めた直後は、前の読みの停止の知らせ（保持しているのは前の読み）が先に届く。
        const ours = isCurrentSession(state.retained?.nodeId);
        setStatus((prev) => {
            if (prev.ply === null) return prev;
            if (state.phase === "running") {
                if (!ours) return prev;
                return prev.phase === "searching" ? prev : { ...prev, phase: "searching" };
            }
            // 求めた直後の select は、いまの（止まっている）状態を知らせてくる。読み始めるまでは
            // 「準備中」のままにする（一瞬「止まった」「続けて読む」と見せない）。
            if (
                prev.phase === "preparing" &&
                state.phase !== "error" &&
                state.phase !== "disposed"
            ) {
                return prev;
            }
            if (state.phase === "preparing" || state.phase === "stopping") return prev;
            if (!ours && state.phase !== "error" && state.phase !== "disposed") return prev;
            const canContinue = state.canResume && ours;
            if (prev.phase === "stopped" && prev.canContinue === canContinue) return prev;
            return {
                ...prev,
                phase: "stopped",
                canContinue,
                endedAt: prev.endedAt ?? Date.now(),
            };
        });
    });
    const onControllerInfo = useEffectEvent((nodeId: string, info: EngineInfoEvent) => {
        const session = sessionRef.current;
        if (!acceptingInfoRef.current || !session || session.nodeId !== nodeId) return;
        if (info.scoreCp !== undefined || info.scoreMate !== undefined) {
            options.recordEvalByPly(session.ply, info);
        }
        if (info.nodes !== undefined) {
            const nodes = baseNodesRef.current + info.nodes;
            setStatus((prev) => (prev.nodes === nodes ? prev : { ...prev, nodes }));
        }
    });
    const onControllerFinished = useEffectEvent((nodeId: string, totalNodes: number) => {
        if (!isCurrentSession(nodeId)) return;
        baseNodesRef.current = totalNodes;
        setStatus((prev) => (prev.ply === null ? prev : { ...prev, nodes: totalNodes }));
    });

    // 再開できる解析を試すのは、ヒント専用にエンジンを 1 つ作れるときだけ。外部 USI エンジンは再開できず、
    // Desktop の内蔵エンジン（maxParallel 1）は全クライアントが共有するので、別に作ると対局のエンジンを乱す。
    const canHostResumable =
        options.engineOption !== undefined &&
        options.engineOption.kind !== "external" &&
        options.engineOption.maxParallel !== 1;

    // 設定（エンジン・スレッド・候補数・評価関数）は解析の準備で 1 度だけ当てるので、変わったら作り直す。
    // 作り直した読みは前の読みを続けられないので、ヒントの印も消して、もう一度求められるようにする。
    // biome-ignore lint/correctness/useExhaustiveDependencies: settingsKey が設定の変化を表す
    useEffect(() => {
        generationRef.current += 1;
        sessionRef.current = null;
        setStatus(IDLE);
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
            onState: (state) => {
                if (controllerRef.current !== controller) return;
                onControllerState(state);
                // 再開できないと分かったら、試しに作ったエンジンはすぐ手放す（以後は 1 回だけの読み）。
                if (state.phase === "unsupported") {
                    controllerRef.current = null;
                    void controller.dispose();
                }
            },
            onInfo: (target, _sessionId, info) => {
                if (controllerRef.current === controller) onControllerInfo(target.nodeId, info);
            },
            onFinished: (target, result) => {
                if (controllerRef.current === controller)
                    onControllerFinished(target.nodeId, result.totalNodes);
            },
        });
        controllerRef.current = controller;
        unsupportedRef.current = false;
        return () => {
            if (controllerRef.current === controller) controllerRef.current = null;
            void controller.dispose();
        };
    }, [options.enabled, settingsKey, canHostResumable]);

    const startFallback = (ply: number, generation: number) => {
        usingFallbackRef.current = true;
        void options.fallback
            .analyze(ply, {
                multiPv: options.multiPv,
                timeMs: HINT_SEARCH_TIME_MS,
                depth: HINT_SEARCH_MAX_DEPTH,
                shouldStart: () => generationRef.current === generation,
            })
            .then((started) => {
                if (started || generationRef.current !== generation) return;
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
        generationRef.current += 1;
        acceptingInfoRef.current = false;
        // 準備中に止めたら、準備が終わっても始めないので、ここで止まった状態にする（求め直せるように）。
        setStatus((prev) =>
            prev.phase === "preparing"
                ? { ...prev, phase: "stopped", canContinue: false, endedAt: Date.now() }
                : prev,
        );
        if (usingFallbackRef.current) {
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
        const generation = ++generationRef.current;
        const now = Date.now();
        if (!resume || !sessionRef.current) {
            sessionRef.current = { nodeId: `${positionKey}#${++sessionSerialRef.current}`, ply };
            baseNodesRef.current = 0;
            options.clearEvalByPly(ply);
        }
        const { nodeId } = sessionRef.current;
        acceptingInfoRef.current = true;
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
        const controller = controllerRef.current;
        if (unsupportedRef.current || !controller) {
            startFallback(ply, generation);
            return;
        }
        usingFallbackRef.current = false;
        void (async () => {
            await controller.select({
                nodeId,
                sfen: options.startSfen,
                moves: options.moves,
                loadOptions: buildPassRightsOption(options.passRightsSettings, options.moves),
            });
            // 準備（前の読みの停止）を待つ間に止められた・やり直された要求は始めない。
            if (generationRef.current !== generation) return;
            await controller.start(BUDGET);
            if (generationRef.current !== generation) {
                await controller.pause();
                return;
            }
            // 準備の途中で「再開できない」と分かったら、その場で 1 回だけの読みに切り替える。
            if (unsupportedRef.current) startFallback(ply, generation);
        })();
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
            sessionRef.current = null;
            baseNodesRef.current = 0;
            setStatus(IDLE);
        },
    };
}
