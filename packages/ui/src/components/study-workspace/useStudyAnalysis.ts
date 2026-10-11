/**
 * 研究ノートの解析の実行。
 *
 * 既存の検討モードと同じ部品（エンジンのプール、NNUE の解決、AI のダウンロード確認、
 * 解析の設定の保存先）を使い、結果を研究ノートの操作（`ensureLayer` / `putAnalysis`）にして流す。
 * 解析を始めた時点の設定から解析レイヤーを決め、その探索の結果に最後まで付けて運ぶ。
 */

import {
    buildStudyLayerRefFromNnue,
    createDefaultNnueSelection,
    DEFAULT_PRESET_KEY,
    type KifuTree,
    type NnueMeta,
    type NnueSelection,
    type PresetConfig,
    type ResolvedNnue,
    resolveWorkerCount,
    STUDY_LIMITS,
    type StudyAnalysisCompletion,
    type StudyDocument,
    type StudyLayer,
    type StudyLayerRef,
    type StudyLayerSpecInput,
    type StudyOp,
} from "@shogi/app-core";
import type { EngineInfoEvent } from "@shogi/engine-client";
import { useEffect, useRef, useState } from "react";
import { useNnueContextOptional } from "../../providers/NnueContext";
import { type AnalysisJob, useEnginePool } from "../shogi-match/hooks/useEnginePool";
import { useLocalStorage } from "../shogi-match/hooks/useLocalStorage";
import { useMatchNnueDownload } from "../shogi-match/hooks/useMatchNnueDownload";
import { useNnueManager } from "../shogi-match/hooks/useNnueManager";
import {
    type AnalysisSettings,
    DEFAULT_ANALYSIS_SETTINGS,
    type EngineOption,
    type Message,
} from "../shogi-match/types";
import { collectTreeAnalysisJobs } from "../shogi-match/utils/branchTreeUtils";
import { countStudyUnanalyzed, studyPathTo } from "./studyView";

/** 「この局面を深く解析」の探索時間（ミリ秒）。 */
export const STUDY_DEEP_TIME_MS = 10_000;
/** 「この局面を深く解析」の探索深さの上限（時間で止まる前提の大きめの値）。 */
const STUDY_DEEP_DEPTH = 64;
/** 「この局面を深く解析」で読む候補手の数の下限。 */
const STUDY_DEEP_MIN_MULTI_PV = 3;

/** NNUE を使わない（駒得だけで評価する）ときの AI の表示名。 */
const MATERIAL_AI_NAME = "簡易AI（駒得）";
/** NNUE を使わない AI の選択。ダウンロードなしで解析を始められる。 */
const MATERIAL_SELECTION: NnueSelection = { presetKey: null, nnueId: null };

/** 解析結果を文書へ反映する間隔（ミリ秒）。1 局面ごとに反映すると、局面の多いノートで画面が重くなる。 */
const RESULT_FLUSH_INTERVAL_MS = 400;

/**
 * 操作を渡した結果。保存できなかった（上限を超えた、など）とき `false` で解決する Promise を
 * 返すと、解析を止める。何も返さなければ成功として扱う。
 */
// biome-ignore lint/suspicious/noConfusingVoidType: 何も返さないコールバック（`() => void`）もそのまま渡せるようにする
export type StudyApplyOpsResult = void | Promise<boolean>;

/** 内蔵エンジンの識別情報（解析レイヤーの条件に入る）。 */
export interface StudyEngineIdentity {
    kind: StudyLayerSpecInput["engine"]["kind"];
    name: string;
    /** エンジンの版。取れなければ null（アプリの版で代用する）。 */
    version: string | null;
    appVersion: string;
}

/** 深く解析している途中経過（保存はしない。表示だけ）。 */
interface StudyLiveSearch {
    nodeId: string;
    depth: number | null;
}

/** 解析の設定を変える画面に渡すもの。 */
export interface StudyAnalysisSettingsForm {
    settings: AnalysisSettings;
    onSettingsChange: (settings: AnalysisSettings) => void;
    nnueSelection: NnueSelection;
    onNnueSelectionChange: (selection: NnueSelection) => void;
    presets: PresetConfig[];
    nnueList: NnueMeta[];
    isNnueListLoading: boolean;
}

/** 画面が解析を操作するための窓口。 */
export interface StudyAnalysisController {
    /** 実行中の解析。`full` = 全体、`deep` = いまの局面を深く。 */
    mode: "full" | "deep" | null;
    /** AI の準備中（ダウンロードの確認など）。 */
    isPreparing: boolean;
    /** 全体解析の進み具合。 */
    progress: { completed: number; total: number } | null;
    /** 深く解析している途中経過。 */
    live: StudyLiveSearch | null;
    /** いまの設定で解析したときの表示名（例: 「RAMU・1 秒」）。 */
    settingsLabel: string;
    /** いまの設定で全体を解析したときに、実際に解析する局面の数。 */
    fullTargetCount: number;
    /** いまの設定で、まだ解析していない局面をすべて解析する。 */
    startFull: () => Promise<void>;
    /**
     * 既にある解析結果（レイヤー）の続きを、**その結果と同じ設定**で解析する（「残りを解析」）。
     * 設定の画面に残っている値は使わない。
     */
    resumeLayer: (layerId: string) => Promise<void>;
    /** 指定した局面を長い時間で解析する。 */
    startDeep: (nodeId: string) => Promise<void>;
    cancel: () => Promise<void>;
    form: StudyAnalysisSettingsForm;
}

interface UseStudyAnalysisOptions {
    doc: StudyDocument;
    /** 文書から作った棋譜ツリー（ノード ID は保存用の `nodeId`）。 */
    tree: KifuTree;
    engineOptions: EngineOption[];
    manifestUrl: string;
    engine: StudyEngineIdentity;
    defaultNnuePresetKey?: string;
    onApplyOps: (ops: StudyOp[]) => StudyApplyOpsResult;
    /** 解析の区切り（完了・中止）。送信待ちをすぐ流すのに使う。 */
    onFlush?: () => void;
    /** 解析を始めたレイヤー（画面はこのレイヤーを表示に切り替える）。 */
    onLayerStarted: (layerId: string, mode: "full" | "deep") => void;
    setMessage: (message: Message | null) => void;
}

const formatSeconds = (timeMs: number): string => {
    const seconds = timeMs / 1000;
    return Number.isInteger(seconds) ? `${seconds} 秒` : `${Number(seconds.toFixed(2))} 秒`;
};

export function useStudyAnalysis({
    doc,
    tree,
    engineOptions,
    manifestUrl,
    engine,
    defaultNnuePresetKey,
    onApplyOps,
    onFlush,
    onLayerStarted,
    setMessage,
}: UseStudyAnalysisOptions): {
    controller: StudyAnalysisController;
    /** AI のダウンロード確認ダイアログ（`MatchNnueDownloadDialog`）に渡す状態。 */
    download: ReturnType<typeof useMatchNnueDownload>;
    /** ダウンロードをやめ、簡易 AI に切り替えて、頼まれていた解析を始める。 */
    switchToSimpleAi: () => void;
} {
    // 解析の設定は既存の検討モードと同じ保存先を使う（どちらで変えても同じ設定になる）。
    const [storedSettings, setSettings] = useLocalStorage<AnalysisSettings>(
        "shogi-analysis-settings",
        DEFAULT_ANALYSIS_SETTINGS,
    );
    const settings = { ...DEFAULT_ANALYSIS_SETTINGS, ...storedSettings };
    const [analysisEngineId] = useLocalStorage<string>(
        "shogi-analysis-engine",
        engineOptions[0]?.id ?? "wasm",
    );
    const engineOption =
        engineOptions.find((option) => option.id === analysisEngineId) ?? engineOptions[0];

    const nnueContext = useNnueContextOptional();
    const {
        analysisNnueSelection,
        setAnalysisNnueSelection,
        analysisNnueId,
        nnueList,
        isNnueListLoading,
        presetConfigs,
        resolveNnue,
    } = useNnueManager({
        defaultNnueSelection: createDefaultNnueSelection(
            defaultNnuePresetKey ?? DEFAULT_PRESET_KEY,
        ),
        manifestUrl,
        // 対局用のエンジンは持たないので、再起動するものは無い。
        restartEngineForNnue: () => Promise.resolve(),
    });
    const download = useMatchNnueDownload({
        manifestUrl,
        resolveNnue,
        setMessage,
        cancelReason: "解析を始められません",
    });

    const [mode, setMode] = useState<"full" | "deep" | null>(null);
    const [isPreparing, setIsPreparing] = useState(false);
    const [live, setLive] = useState<StudyLiveSearch | null>(null);

    // 解析は非同期に進むので、結果が届いた時点の最新の文書・コールバックを参照する。
    const latestRef = useRef({ doc, tree, onApplyOps, onFlush });
    useEffect(() => {
        latestRef.current = { doc, tree, onApplyOps, onFlush };
    }, [doc, tree, onApplyOps, onFlush]);

    // 解析の「世代」。準備（AI の確認・ダウンロード）を待っている間に、中止された・画面を離れた・
    // 別の解析が始まったときは、世代が変わっているので続きを実行しない。
    const generationRef = useRef(0);
    const mountedRef = useRef(true);
    const preparingRef = useRef(false);
    /** 準備中の依頼（ダウンロードをやめて簡易 AI に切り替えたとき、同じ依頼をやり直すのに使う）。 */
    const requestRef = useRef<{ kind: "full" } | { kind: "deep"; nodeId: string } | null>(null);
    /** まだ文書へ反映していない解析結果。 */
    const bufferRef = useRef<{ ops: StudyOp[]; timer: ReturnType<typeof setTimeout> | null }>({
        ops: [],
        timer: null,
    });
    const cancelRef = useRef<() => Promise<void>>(async () => {});

    /** ためてある解析結果を文書へ反映する。保存できなかったら解析を止める。 */
    const flushResults = (): void => {
        const buffer = bufferRef.current;
        if (buffer.timer !== null) {
            clearTimeout(buffer.timer);
            buffer.timer = null;
        }
        if (buffer.ops.length === 0) return;
        const ops = buffer.ops;
        buffer.ops = [];
        const outcome = latestRef.current.onApplyOps(ops);
        if (outcome instanceof Promise) {
            void outcome.then((saved) => {
                // 保存できなかった理由は呼び出し側が画面に出す。ここでは黙って続けないよう止める。
                if (!saved && mountedRef.current) void cancelRef.current();
            });
        }
    };

    const handlePositionAnalyzed = (completion: StudyAnalysisCompletion): void => {
        const { layer, runtimeNodeId, result } = completion;
        if (!layer || runtimeNodeId === null) return;
        const buffer = bufferRef.current;
        // レイヤーは解析の開始時に作ってあるが、他の端末で消されていても結果を失わないよう確かめる
        // （既にあれば何もしない操作で、送信待ちにも入らない）。まとめる単位ごとに 1 回でよい。
        if (buffer.ops.length === 0) {
            buffer.ops.push({ type: "ensureLayer", spec: layer.spec, display: layer.display });
        }
        buffer.ops.push({
            type: "putAnalysis",
            layerId: layer.layerId,
            nodeId: runtimeNodeId,
            result,
        });
        if (buffer.timer === null) {
            buffer.timer = setTimeout(flushResults, RESULT_FLUSH_INTERVAL_MS);
        }
    };

    const pool = useEnginePool({
        createClient:
            engineOption?.createClient ??
            (() => {
                throw new Error("解析に使えるエンジンがありません");
            }),
        clientKey: engineOption?.id,
        workerCount: resolveWorkerCount(settings.parallelWorkers),
        nnueId: analysisNnueId,
        onPositionAnalyzed: handlePositionAnalyzed,
        onResult: (_ply: number, event: EngineInfoEvent, nodeId?: string) => {
            if (!nodeId) return;
            const depth = event.depth ?? null;
            setLive((previous) =>
                previous && previous.nodeId === nodeId && previous.depth !== depth
                    ? { nodeId, depth }
                    : previous,
            );
        },
        onComplete: () => {
            flushResults();
            setMode(null);
            setLive(null);
            latestRef.current.onFlush?.();
        },
        onError: (ply, error) => {
            console.error(`[study] 解析に失敗しました (ply=${ply}):`, error);
            setMessage({
                text: `解析に失敗した局面があります: ${error.message}`,
                type: "error",
            });
        },
    });

    useEffect(() => {
        mountedRef.current = true;
        const buffer = bufferRef.current;
        return () => {
            // 画面を離れたら、準備中の解析は始めない。読み終えていた結果は捨てずに保存する。
            mountedRef.current = false;
            generationRef.current += 1;
            preparingRef.current = false;
            if (buffer.timer !== null) {
                clearTimeout(buffer.timer);
                buffer.timer = null;
            }
            if (buffer.ops.length > 0) {
                const ops = buffer.ops;
                buffer.ops = [];
                void latestRef.current.onApplyOps(ops);
            }
        };
    }, []);

    const nameOf = (selection: NnueSelection): string => {
        if (selection.presetKey) {
            return (
                presetConfigs.find((preset) => preset.presetKey === selection.presetKey)
                    ?.displayName ?? selection.presetKey
            );
        }
        if (selection.nnueId) {
            return nnueList.find((nnue) => nnue.id === selection.nnueId)?.displayName ?? "AI";
        }
        return MATERIAL_AI_NAME;
    };
    const settingsLabel = `${nameOf(analysisNnueSelection)}・${formatSeconds(settings.batchAnalysisTimeMs)}`;
    const fullMultiPv = Math.min(STUDY_LIMITS.multiPv, Math.max(1, settings.multiPv));
    // いまの設定に当たる解析結果が既にあれば、その続きから解析する。レイヤーの ID は AI の
    // ファイルを確かめないと決まらないので、ここでは表示名と探索の条件で見分ける。
    const fullTargetLayer = doc.layers.find(
        (layer) =>
            layer.display.label === settingsLabel &&
            layer.spec.limits.timeMs === settings.batchAnalysisTimeMs &&
            layer.spec.limits.depth === settings.batchAnalysisDepth &&
            layer.spec.multiPv === fullMultiPv,
    );
    const fullTargetCount = countStudyUnanalyzed(doc, fullTargetLayer?.id ?? null);

    /** AI を準備し、解析レイヤーを決める。準備できなければ null（理由は画面に出す）。 */
    const prepareLayer = async (
        selection: NnueSelection,
        limits: { timeMs: number; depth: number },
        multiPv: number,
    ): Promise<{ layer: StudyLayerRef; resolved: ResolvedNnue | null } | null> => {
        if (!(await download.ensureMatchNnue([selection]))) return null;
        let resolved: ResolvedNnue | null;
        let meta: NnueMeta | null = null;
        try {
            resolved = await resolveNnue(selection);
            if (resolved) {
                meta = (await nnueContext?.storage.getMeta(resolved.nnueId)) ?? null;
            }
        } catch (error) {
            setMessage({
                text: `解析を始められません: ${error instanceof Error ? error.message : "AI の準備に失敗しました"}`,
                type: "error",
            });
            return null;
        }
        const isInternal = engineOption?.kind !== "external";
        try {
            const layer = buildStudyLayerRefFromNnue({
                engine: isInternal
                    ? { kind: engine.kind, name: engine.name, version: engine.version }
                    : { kind: "external", name: engineOption?.label ?? "external", version: null },
                appVersion: engine.appVersion,
                resolved,
                meta,
                fallbackName: isInternal ? MATERIAL_AI_NAME : engineOption?.label,
                limits,
                multiPv,
            });
            return { layer, resolved };
        } catch (error) {
            setMessage({
                text: `解析を始められません: ${error instanceof Error ? error.message : String(error)}`,
                type: "error",
            });
            return null;
        }
    };

    /** レイヤーを文書に足せるか（1 つのノートに持てる数の上限）。 */
    const canUseLayer = (layerId: string): boolean => {
        const current = latestRef.current.doc;
        if (current.layers.some((item) => item.id === layerId)) return true;
        if (current.layers.length < STUDY_LIMITS.layersPerStudy) return true;
        setMessage({
            text: `解析の設定は 1 つのノートに ${STUDY_LIMITS.layersPerStudy} 種類までです。`,
            type: "error",
        });
        return false;
    };

    const run = (
        jobs: AnalysisJob[],
        prepared: { layer: StudyLayerRef; resolved: ResolvedNnue | null },
        multiPv: number,
        nextMode: "full" | "deep",
    ): void => {
        const { layer, resolved } = prepared;
        void latestRef.current.onApplyOps([
            { type: "ensureLayer", spec: layer.spec, display: layer.display },
        ]);
        onLayerStarted(layer.layerId, nextMode);
        setMode(nextMode);
        pool.start(jobs, {
            nnueId: resolved?.nnueId ?? null,
            layerStacks: resolved?.layerStacks,
            fvScale: resolved?.fvScale,
            multiPv,
            layer,
        });
    };

    /**
     * 準備から開始までを 1 つの世代として実行する。準備を待つ間に中止・離脱・別の解析の開始が
     * あれば `isCurrent()` が false になるので、そこで止める。
     */
    const withPreparation = async (
        request: { kind: "full" } | { kind: "deep"; nodeId: string },
        task: (isCurrent: () => boolean) => Promise<void>,
    ): Promise<void> => {
        if (pool.isRunning || preparingRef.current || !mountedRef.current) return;
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        preparingRef.current = true;
        requestRef.current = request;
        setIsPreparing(true);
        try {
            setMessage(null);
            await task(() => mountedRef.current && generationRef.current === generation);
        } finally {
            if (generationRef.current === generation) {
                preparingRef.current = false;
                requestRef.current = null;
                if (mountedRef.current) setIsPreparing(false);
            }
        }
    };

    /**
     * 全体を解析する。`target` を渡すと、設定の画面の値ではなく、その解析結果（レイヤー）と
     * 同じ探索の条件で、その続きを解析する。
     */
    const startFullWith = (selection: NnueSelection, target?: StudyLayer): Promise<void> =>
        withPreparation({ kind: "full" }, async (isCurrent) => {
            const limits = {
                timeMs: target?.spec.limits.timeMs ?? settings.batchAnalysisTimeMs,
                depth: target?.spec.limits.depth ?? settings.batchAnalysisDepth,
            };
            const multiPv = target?.spec.multiPv ?? fullMultiPv;
            const prepared = await prepareLayer(selection, limits, multiPv);
            if (!isCurrent() || !prepared) return;
            if (target && prepared.layer.layerId !== target.id) {
                // AI のファイルや版が違うと、同じ設定の続きにならない。別の結果を黙って作らない。
                setMessage({
                    text: `「${target.display.label}」と同じ条件の AI を用意できないため、続きを解析できません。「設定を変える」から、解析する設定を選び直してください。`,
                    type: "error",
                });
                return;
            }
            if (!canUseLayer(prepared.layer.layerId)) return;
            const current = latestRef.current;
            const results =
                current.doc.layers.find((item) => item.id === prepared.layer.layerId)?.results ??
                {};
            const jobs: AnalysisJob[] = collectTreeAnalysisJobs(current.tree, {
                includeRoot: true,
                // 中断した結果しか無い局面は、もう一度解析する。
                isAnalyzed: (node) =>
                    Object.hasOwn(results, node.id) && results[node.id].completion === "completed",
            }).map((job) => ({
                ply: job.ply,
                sfen: current.tree.startSfen,
                moves: job.moves,
                timeMs: limits.timeMs,
                depth: limits.depth,
                nodeId: job.nodeId,
                sideToMove: job.sideToMove,
            }));
            if (jobs.length === 0) {
                // 解析済みの設定を選び直しただけ。表示をそのレイヤーに切り替える。
                onLayerStarted(prepared.layer.layerId, "full");
                return;
            }
            run(jobs, prepared, multiPv, "full");
        });

    /** 解析結果（レイヤー）を作ったときの AI の選択。このブラウザで分からなければ null。 */
    const selectionOfLayer = (layer: StudyLayer): NnueSelection | null => {
        const sha256 = layer.spec.evaluation.nnueSha256;
        if (sha256 === null) return MATERIAL_SELECTION;
        if (layer.display.presetKey) return { presetKey: layer.display.presetKey, nnueId: null };
        const stored = nnueList.find((nnue) => nnue.contentHashSha256.toLowerCase() === sha256);
        return stored ? { presetKey: null, nnueId: stored.id } : null;
    };

    const resumeLayer = async (layerId: string): Promise<void> => {
        const target = latestRef.current.doc.layers.find((layer) => layer.id === layerId);
        if (!target) return;
        const selection = selectionOfLayer(target);
        if (selection === null) {
            setMessage({
                text: `「${target.display.label}」で使った AI がこのブラウザに無いため、続きを解析できません。「設定を変える」から、解析する設定を選び直してください。`,
                type: "error",
            });
            return;
        }
        await startFullWith(selection, target);
    };

    const startDeepWith = (nodeId: string, selection: NnueSelection): Promise<void> =>
        withPreparation({ kind: "deep", nodeId }, async (isCurrent) => {
            const limits = { timeMs: STUDY_DEEP_TIME_MS, depth: STUDY_DEEP_DEPTH };
            const multiPv = Math.min(
                STUDY_LIMITS.multiPv,
                Math.max(STUDY_DEEP_MIN_MULTI_PV, settings.multiPv),
            );
            const prepared = await prepareLayer(selection, limits, multiPv);
            if (!isCurrent() || !prepared || !canUseLayer(prepared.layer.layerId)) return;
            const current = latestRef.current;
            const node = current.tree.nodes.get(nodeId);
            if (!node) return;
            const moves: string[] = [];
            for (const id of studyPathTo(current.tree, nodeId)) {
                const move = current.tree.nodes.get(id)?.usiMove;
                if (move) moves.push(move);
            }
            setLive({ nodeId, depth: null });
            run(
                [
                    {
                        ply: node.ply,
                        sfen: current.tree.startSfen,
                        moves,
                        timeMs: limits.timeMs,
                        depth: limits.depth,
                        nodeId,
                        sideToMove: node.positionAfter.turn,
                    },
                ],
                prepared,
                multiPv,
                "deep",
            );
        });

    const cancel = async (): Promise<void> => {
        // 準備中の解析も、ここで無効にする。
        generationRef.current += 1;
        preparingRef.current = false;
        requestRef.current = null;
        if (mountedRef.current) setIsPreparing(false);
        // 止めた探索は、そこまでの結果が「中断」として `onPositionAnalyzed` に届く。
        await pool.cancel();
        flushResults();
        if (!mountedRef.current) return;
        setMode(null);
        setLive(null);
        latestRef.current.onFlush?.();
    };
    cancelRef.current = cancel;

    const switchToSimpleAi = (): void => {
        const request = requestRef.current;
        // 確認ダイアログを閉じる（待っていた準備は「ダウンロードしない」で終わる）。
        generationRef.current += 1;
        preparingRef.current = false;
        requestRef.current = null;
        download.cancel();
        setAnalysisNnueSelection(MATERIAL_SELECTION);
        setIsPreparing(false);
        if (!request) return;
        // 選択の保存を待たず、簡易 AI を指定して同じ依頼をやり直す。閉じたダイアログの後始末
        // （AI の確認の終了）が済んでから始めるよう、次のタスクに回す。
        setTimeout(() => {
            if (!mountedRef.current) return;
            void (request.kind === "full"
                ? startFullWith(MATERIAL_SELECTION)
                : startDeepWith(request.nodeId, MATERIAL_SELECTION));
        }, 0);
    };

    const activeMode = pool.isRunning ? mode : null;
    return {
        controller: {
            mode: activeMode,
            isPreparing,
            progress:
                activeMode === "full" && pool.progress
                    ? { completed: pool.progress.completed, total: pool.progress.total }
                    : null,
            live: activeMode === "deep" ? live : null,
            settingsLabel,
            fullTargetCount,
            startFull: () => startFullWith(analysisNnueSelection),
            resumeLayer,
            startDeep: (nodeId) => startDeepWith(nodeId, analysisNnueSelection),
            cancel,
            form: {
                settings,
                onSettingsChange: setSettings,
                nnueSelection: analysisNnueSelection,
                onNnueSelectionChange: setAnalysisNnueSelection,
                presets: presetConfigs,
                nnueList,
                isNnueListLoading,
            },
        },
        download,
        switchToSimpleAi,
    };
}
