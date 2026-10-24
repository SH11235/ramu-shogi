/**
 * 研究ノートの「この局面を深く解析」を、止めても続きから読める探索で行う。
 *
 * 再開できる解析（Web の wasm エンジンの協調停止）が使えるときは、止めても読みの状態（置換表・深さ）を
 * 残し、「続けて読む」でその続きから読む。止めるたび・上限に届くたびに、そこまでの結果を渡す。
 * 使えないとき（Desktop のネイティブエンジン、外部 USI エンジン、共有メモリの無いブラウザ）は
 * `start` が false を返すので、呼び出し側が 1 回だけの読みに切り替える。
 */

import type { InteractiveAnalysisState } from "@shogi/app-controller";
import { createAnalysisController } from "@shogi/app-controller";
import {
    createStudyAnalysisCollector,
    type Player,
    type StudyAnalysisCollector,
    type StudyAnalysisResult,
    type StudyLayerRef,
} from "@shogi/app-core";
import type { EngineClient, LayerStacksOptions, LoadPositionOptions } from "@shogi/engine-client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { MATERIAL_FALLBACK_LEVEL } from "../shogi-match/hooks/useEnginePool";

/** エンジンの準備に使う条件。変わったらエンジンを作り直す（読みの続きは無くなる）。 */
interface StudyDeepSetup {
    nnueId: string | null;
    layerStacks?: LayerStacksOptions;
    fvScale?: number;
    /** NNUE を使わないときに、駒得の評価に切り替える。 */
    materialFallback: boolean;
    multiPv: number;
    threads: number;
}

interface StudyDeepRequest {
    /** 解析する局面（保存用の `nodeId`）。 */
    nodeId: string;
    sfen: string;
    moves: string[];
    sideToMove: Player;
    loadOptions?: LoadPositionOptions;
    layer: StudyLayerRef;
    setup: StudyDeepSetup;
}

interface StudyDeepState {
    phase: "idle" | "preparing" | "running" | "paused";
    /** 読んでいる・止めている局面。 */
    nodeId: string | null;
    /** いまの読みの深さ（読んでいる間だけ更新する）。 */
    depth: number | null;
    /** 止めた読みを、同じ局面の続きから読める。 */
    canContinue: boolean;
}

interface Options {
    createClient: (() => EngineClient) | null;
    /** エンジンを見分ける値。変わったら、持っている読みを手放す。 */
    clientKey: string | undefined;
    /** 1 回の読みの上限（ミリ秒）。続けて読むたびに、この分だけ読み足す。 */
    budgetMs: number;
    onResult: (request: StudyDeepRequest, result: StudyAnalysisResult) => void;
    onError: (message: string) => void;
}

const IDLE: StudyDeepState = { phase: "idle", nodeId: null, depth: null, canContinue: false };

interface Session {
    /** 解析の部品に渡す ID。同じ局面でも、新しく始めるたびに別の ID にする。 */
    key: string;
    request: StudyDeepRequest;
    collector: StudyAnalysisCollector;
}

export function useStudyDeepSearch(options: Options): {
    state: StudyDeepState;
    start: (request: StudyDeepRequest) => Promise<boolean>;
    resume: () => Promise<void>;
    stop: () => Promise<void>;
    release: () => Promise<void>;
} {
    const [state, setState] = useState<StudyDeepState>(IDLE);
    const controllerRef = useRef<{
        controller: ReturnType<typeof createAnalysisController>;
        setupKey: string;
    } | null>(null);
    const sessionRef = useRef<Session | null>(null);
    const serialRef = useRef(0);
    /** 再開できる解析が使えないと分かった（以後は呼び出し側の 1 回だけの読みにする）。 */
    const unsupportedRef = useRef(false);

    const onControllerState = useEffectEvent((controllerState: InteractiveAnalysisState) => {
        const session = sessionRef.current;
        if (controllerState.phase === "error") {
            sessionRef.current = null;
            setState(IDLE);
            options.onError(controllerState.error ?? "解析に失敗しました");
            return;
        }
        // 別の読み（前に止めた読みなど）の知らせは写さない。
        if (!session || controllerState.retained?.nodeId !== session.key) return;
        const nodeId = session.request.nodeId;
        if (controllerState.phase === "running") {
            setState((prev) =>
                prev.phase === "running" && prev.nodeId === nodeId
                    ? prev
                    : { phase: "running", nodeId, depth: prev.depth, canContinue: false },
            );
        } else if (controllerState.phase === "paused" || controllerState.phase === "idle") {
            setState((prev) => ({
                phase: "paused",
                nodeId,
                depth: prev.depth,
                canContinue: controllerState.canResume,
            }));
        }
    });

    const onControllerInfo = useEffectEvent(
        (key: string, info: Parameters<StudyAnalysisCollector["push"]>[0]) => {
            const session = sessionRef.current;
            if (!session || session.key !== key) return;
            session.collector.push(info);
            const depth = info.depth ?? null;
            if (depth !== null) {
                setState((prev) => (prev.depth === depth ? prev : { ...prev, depth }));
            }
        },
    );

    const onControllerFinished = useEffectEvent(
        (key: string, finished: { reason: string; totalNodes: number; totalTimeMs: number }) => {
            const session = sessionRef.current;
            if (!session || session.key !== key) return;
            // 上限の時間まで読む前に止めた結果は「途中まで」。上限まで読んだあとに続けて読んで止めた
            // 結果は、上限まで読んだ結果より深いので「済んだ」として保存する（同じ局面の結果は「済んだ」
            // ものが「途中まで」より優先されるので、続きの結果で置き換わるように）。
            const completion =
                finished.reason === "paused" && finished.totalTimeMs < options.budgetMs
                    ? "aborted"
                    : "completed";
            const result = session.collector.finish(completion);
            if (!result) return;
            options.onResult(session.request, {
                ...result,
                nodes: finished.totalNodes,
                timeMs: finished.totalTimeMs,
            });
        },
    );

    const release = async (): Promise<void> => {
        const current = controllerRef.current;
        // 読んでいる途中なら止めて、そこまでの結果を渡してから手放す。
        await current?.controller.pause();
        if (controllerRef.current !== current) return;
        controllerRef.current = null;
        sessionRef.current = null;
        setState(IDLE);
        await current?.controller.dispose();
    };

    // エンジンを切り替えたら、前のエンジンの読みは手放す（再開できるかも、改めて確かめる）。
    // biome-ignore lint/correctness/useExhaustiveDependencies: clientKey がエンジンの変化を表す
    useEffect(() => {
        unsupportedRef.current = false;
        return () => {
            void release();
        };
    }, [options.clientKey]);

    const controllerFor = (setup: StudyDeepSetup) => {
        const setupKey = JSON.stringify(setup);
        const current = controllerRef.current;
        if (current && current.setupKey === setupKey) return current.controller;
        void current?.controller.dispose();
        const createClient = options.createClient;
        if (!createClient) return null;
        const controller = createAnalysisController({
            createClient,
            prepare: async (client) => {
                await client.init({ threads: setup.threads });
                if (setup.nnueId && client.loadNnue) {
                    await client.loadNnue(setup.nnueId, setup.layerStacks);
                    if (setup.fvScale !== undefined) {
                        await client.setOption("FV_SCALE", setup.fvScale);
                    }
                } else if (setup.materialFallback) {
                    await client.setOption("MaterialLevel", MATERIAL_FALLBACK_LEVEL);
                }
                await client.setOption("MultiPV", String(setup.multiPv));
            },
            onState: (controllerState) => {
                if (controllerRef.current?.controller === controller) {
                    onControllerState(controllerState);
                }
            },
            onInfo: (target, _sessionId, info) => {
                if (controllerRef.current?.controller === controller) {
                    onControllerInfo(target.nodeId, info);
                }
            },
            onFinished: (target, result) => {
                if (controllerRef.current?.controller === controller) {
                    onControllerFinished(target.nodeId, result);
                }
            },
        });
        controllerRef.current = { controller, setupKey };
        return controller;
    };

    const budget = () => ({ type: "time", milliseconds: options.budgetMs }) as const;

    const start = async (request: StudyDeepRequest): Promise<boolean> => {
        if (unsupportedRef.current) return false;
        const controller = controllerFor(request.setup);
        if (!controller) return false;
        const key = `${request.nodeId}#${++serialRef.current}`;
        sessionRef.current = {
            key,
            request,
            collector: createStudyAnalysisCollector({
                runId: crypto.randomUUID(),
                sideToMove: request.sideToMove,
                execution: { threads: request.setup.threads, parallelWorkers: 1 },
            }),
        };
        setState({ phase: "preparing", nodeId: request.nodeId, depth: null, canContinue: false });
        await controller.select({
            nodeId: key,
            sfen: request.sfen,
            moves: request.moves,
            loadOptions: request.loadOptions,
        });
        if (sessionRef.current?.key !== key) return true;
        await controller.start(budget());
        if (controller.getState().phase === "unsupported") {
            unsupportedRef.current = true;
            await release();
            return false;
        }
        return true;
    };

    const resume = async (): Promise<void> => {
        const controller = controllerRef.current?.controller;
        if (!controller || !sessionRef.current || !state.canContinue) return;
        setState((prev) => ({ ...prev, phase: "preparing", canContinue: false }));
        await controller.start(budget());
    };

    const stop = async (): Promise<void> => {
        const controller = controllerRef.current?.controller;
        if (!controller) return;
        // 準備中に止めたら、準備が終わっても始めない。
        setState((prev) => (prev.phase === "preparing" ? { ...prev, phase: "paused" } : prev));
        await controller.pause();
    };

    return { state, start, resume, stop, release };
}
