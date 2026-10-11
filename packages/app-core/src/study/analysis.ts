/**
 * 解析と研究ノートの接続。
 *
 * - 探索中に流れてくる情報を 1 回の探索の解析結果（`StudyAnalysisResult`）にまとめる。
 * - 解析を始めた時点の設定から解析レイヤーの `spec` と表示名を作る。
 */

import type { Player } from "../game/board";
import { studyLayerId } from "./ids";
import { kifuEvalToStudyScore } from "./score";
import {
    STANDARD_STUDY_RULES,
    STUDY_LIMITS,
    type StudyAnalysisResult,
    type StudyCandidate,
    type StudyEngineKind,
    type StudyExecution,
    type StudyLayerDisplay,
    type StudyLayerSpec,
} from "./types";

/** 探索中にエンジンから届く情報（`EngineInfoEvent` と同じ形。評価値は手番側視点）。 */
export interface StudyAnalysisInfo {
    depth?: number;
    seldepth?: number;
    scoreCp?: number;
    scoreMate?: number;
    nodes?: number;
    timeMs?: number;
    multipv?: number;
    pv?: string[];
}

export interface StudyAnalysisCollectorOptions {
    /** この探索の ID（UUID v4）。 */
    runId: string;
    /** 解析する局面の実際の手番。評価値を先手視点に直すのに使う。 */
    sideToMove: Player;
    /** 端末の資源の情報。取れない値は null。 */
    execution?: Partial<StudyExecution>;
}

export interface StudyAnalysisCollector {
    /** 探索中の情報を 1 件取り込む。 */
    push(info: StudyAnalysisInfo): void;
    /**
     * 探索の終了時に呼び、解析結果を得る。
     * 評価値つきの最善候補が 1 本も無ければ null（保存する結果が無い）。
     */
    finish(completion: StudyAnalysisResult["completion"]): StudyAnalysisResult | null;
}

const toCount = (value: number | undefined): number | null =>
    value !== undefined && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;

/**
 * 1 回の探索の情報を集めて解析結果にする。
 *
 * 候補（MultiPV の順位）ごとに最後に届いた評価値つきの情報を採用する。別の探索の候補は
 * 継ぎ足さない（探索ごとに作り直すこと）。評価値は `sideToMove` で先手視点に直す。
 */
export function createStudyAnalysisCollector(
    options: StudyAnalysisCollectorOptions,
): StudyAnalysisCollector {
    const candidates = new Map<number, StudyCandidate>();
    let nodes: number | null = null;
    let timeMs: number | null = null;

    return {
        push(info) {
            const infoNodes = toCount(info.nodes);
            if (infoNodes !== null) nodes = Math.max(nodes ?? 0, infoNodes);
            const infoTime = toCount(info.timeMs);
            if (infoTime !== null) timeMs = Math.max(timeMs ?? 0, infoTime);

            const score = kifuEvalToStudyScore(
                { scoreCp: info.scoreCp, scoreMate: info.scoreMate },
                options.sideToMove,
            );
            if (score === null) return;
            const rank = info.multipv ?? 1;
            if (!Number.isInteger(rank) || rank < 1 || rank > STUDY_LIMITS.multiPv) return;
            const previous = candidates.get(rank);
            const pv = info.pv && info.pv.length > 0 ? info.pv : (previous?.pv ?? []);
            candidates.set(rank, {
                rank,
                score,
                depth: toCount(info.depth) ?? 0,
                seldepth: toCount(info.seldepth),
                pv: pv.slice(0, STUDY_LIMITS.pvLength),
            });
        },
        finish(completion) {
            const best = candidates.get(1);
            if (!best) return null;
            const ordered = [...candidates.values()].sort((a, b) => a.rank - b.rank);
            return {
                runId: options.runId,
                completion,
                depth: best.depth,
                nodes,
                timeMs,
                execution: {
                    threads: options.execution?.threads ?? null,
                    hashMb: options.execution?.hashMb ?? null,
                    parallelWorkers: options.execution?.parallelWorkers ?? null,
                },
                candidates: ordered,
            };
        },
    };
}

/** 解析レイヤーの `spec` を作る材料。解析を始めた時点の設定を渡す。 */
export interface StudyLayerSpecInput {
    engine: {
        kind: StudyEngineKind;
        /** 内蔵エンジンは `"rshogi"`。外部 USI エンジンはエンジンの名前。 */
        name: string;
        /**
         * エンジンの版。内蔵エンジンは rshogi-core の版、外部 USI エンジンは `id name` の文字列。
         * 取れないときは null / 空文字にする（`appVersion` から作った値で代用する）。
         */
        version: string | null | undefined;
    };
    /** アプリの版。エンジンの版が取れないときの代用に使う。 */
    appVersion: string;
    /** 使う NNUE。NNUE を使わない（駒得評価）なら null。 */
    nnue: {
        /** NNUE ファイルの SHA-256（64 文字 hex）。 */
        sha256: string;
        fvScale?: number | null;
        /** 進行度係数の SHA-256。無ければ null。 */
        progressSha256?: string | null;
        /** LayerStacks の設定。無ければ null。 */
        layerStacks?: { bucketMode: string; progressBuckets?: number | null } | null;
    } | null;
    /** 実際にエンジンへ渡した探索上限。使わない上限は null / 省略。 */
    limits: { timeMs?: number | null; depth?: number | null; nodes?: number | null };
    multiPv: number;
}

const toLimit = (value: number | null | undefined): number | null =>
    value != null && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;

/**
 * 解析レイヤーの `spec`（設計書 5.5）を作る。
 *
 * 端末の資源（スレッド数・ハッシュ・並列数）は入れない。エンジンの版が取れないときは
 * `app-<アプリの版>` を入れる（汎用の `unknown` で別物を合流させないため）。
 */
export function buildStudyLayerSpec(input: StudyLayerSpecInput): StudyLayerSpec {
    const version =
        typeof input.engine.version === "string" && input.engine.version.trim() !== ""
            ? input.engine.version.trim()
            : `app-${input.appVersion}`;
    const multiPv = Math.min(
        STUDY_LIMITS.multiPv,
        Math.max(1, Math.trunc(Number.isFinite(input.multiPv) ? input.multiPv : 1)),
    );
    return {
        version: 1,
        engine: { kind: input.engine.kind, name: input.engine.name, version },
        evaluation: input.nnue
            ? {
                  nnueSha256: input.nnue.sha256.toLowerCase(),
                  fvScale: toLimit(input.nnue.fvScale),
                  progressSha256: input.nnue.progressSha256?.toLowerCase() ?? null,
                  layerStacks: input.nnue.layerStacks
                      ? {
                            bucketMode: input.nnue.layerStacks.bucketMode,
                            progressBuckets: toLimit(input.nnue.layerStacks.progressBuckets),
                        }
                      : null,
              }
            : { nnueSha256: null, fvScale: null, progressSha256: null, layerStacks: null },
        limits: {
            timeMs: toLimit(input.limits.timeMs),
            depth: toLimit(input.limits.depth),
            nodes: toLimit(input.limits.nodes),
        },
        multiPv,
        rules: STANDARD_STUDY_RULES,
    };
}

const formatSeconds = (timeMs: number): string => {
    const seconds = timeMs / 1000;
    return Number.isInteger(seconds) ? `${seconds} 秒` : `${Number(seconds.toFixed(2))} 秒`;
};

/**
 * 解析レイヤーの表示用の情報を作る（例: 「RAMU・1 秒」）。
 * 探索上限は、時間 → 深さ → ノード数の順で最初に設定されているものを表示名に使う。
 */
export function buildStudyLayerDisplay(input: {
    /** AI の表示名（NNUE の表示名や外部エンジンの名前）。 */
    name: string;
    limits: StudyLayerSpec["limits"];
    presetKey?: string | null;
}): StudyLayerDisplay {
    const { timeMs, depth, nodes } = input.limits;
    const budget =
        timeMs !== null
            ? formatSeconds(timeMs)
            : depth !== null
              ? `深さ ${depth}`
              : nodes !== null
                ? `${nodes} ノード`
                : null;
    const name = input.name.trim() === "" ? "AI" : input.name.trim();
    return {
        label: budget === null ? name : `${name}・${budget}`,
        nnueName: name,
        ...(input.presetKey ? { presetKey: input.presetKey } : {}),
    };
}

/** 解析を始めるときに決め、その探索の結果に最後まで付けて運ぶレイヤーの情報。 */
export interface StudyLayerRef {
    layerId: string;
    spec: StudyLayerSpec;
    display: StudyLayerDisplay;
}

/** `spec` と表示用の情報から、`layerId` つきのレイヤーの情報を作る。 */
export function createStudyLayerRef(
    spec: StudyLayerSpec,
    display: StudyLayerDisplay,
): StudyLayerRef {
    return { layerId: studyLayerId(spec), spec, display };
}
