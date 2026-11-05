/**
 * 研究ノートの詰み探索。いま見ている局面について、手番側の詰みと、手番側に掛かっている詰めろ
 * （手番を相手に渡したら詰まされるか）を調べる。
 *
 * 解析（候補手）とは別のエンジンで解く。詰み探索の間は同じエンジンでほかの操作ができないので、
 * 解析のエンジンを借りると、全体の解析と取り合いになる。エンジンは調べるたびに作って捨てる
 * （詰み探索の置換表は数十 MB あり、スマートフォンで解析のエンジンと並べて持ち続けたくない）。
 * 結果は画面を開いている間だけ覚える。
 *
 * 詰みがある局面では、別に最短手順（詰将棋のルールで無駄合いを数えない）を求められる。最短の証明は
 * 長編で桁違いに重いので、途中で分かった手順（推定・N 手以内の証明）を順に出す。
 */

import { type KifuNode, positionToSfen } from "@shogi/app-core";
import type {
    EngineClient,
    MateLine,
    MateMode,
    MateOutcome,
    MateResult,
} from "@shogi/engine-client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { EngineOption } from "../shogi-match/types";

/** 詰み・詰めろのそれぞれに掛ける時間の上限。 */
export const STUDY_MATE_TIME_MS = 10_000;
/** 最短手順を求めるのに掛ける時間の上限。 */
export const STUDY_SHORTEST_MATE_TIME_MS = 120_000;
/** 1 局面を解くスレッド数。Web のエンジンの既定のスレッド数に合わせる（多く指定してもエンジンのスレッド数に丸められる）。 */
const MATE_THREADS = 4;

type StudyDoneState = {
    status: "done";
    mate: MateResult;
    /** 詰みを調べるのに掛かった時間（ミリ秒）。 */
    mateMs: number;
    threat: MateResult | null;
    /** 詰めろを調べるのに掛かった時間（ミリ秒）。詰めろを調べていなければ null。 */
    threatMs: number | null;
};

export type StudyMateState =
    | {
          status: "running";
          /** いま調べているもの（詰み → 詰めろ の順）。 */
          phase: "mate" | "threat";
          nodes: number;
          elapsedMs: number;
          /** 調べ直す前の結果（調べている間も出しておき、欄の高さを変えない）。 */
          previous?: StudyDoneState;
      }
    | {
          status: "done";
          mate: MateResult;
          mateMs: number;
          /**
           * 手番を相手に渡した局面の結果。手番側に詰みがあるとき・王手されているとき（手番を渡せない）・
           * 手番側の玉が無いときは null。
           */
          threat: MateResult | null;
          threatMs: number | null;
      }
    | { status: "error"; message: string };

/**
 * 最短手順を求める途中で分かった手順。
 * - `estimated`: 推定した手順（この手数で詰むことも、最短であることも証明していない）
 * - `bounded`: この手数以内で詰むことを証明した（最短とは限らない）
 * - `proven`: 最短であることを証明した
 */
export interface StudyShortestLine {
    stage: "estimated" | "bounded" | "proven";
    pv: string[];
}

export type StudyShortestState =
    | {
          status: "running";
          nodes: number;
          elapsedMs: number;
          /** いままでに分かった手順（まだ無ければ null）。 */
          line: StudyShortestLine | null;
      }
    | {
          status: "done";
          /** 分かった手順。`proven` でなければ、時間切れか中止で求め終わっていない。 */
          line: StudyShortestLine | null;
          elapsedMs: number;
      }
    | { status: "error"; message: string };

export interface StudyMateController {
    /** 詰み探索を使えるか（使えるエンジンが無ければ false）。 */
    supported: boolean;
    /** 局面のノードごとの結果（調べたものだけ）。 */
    results: ReadonlyMap<string, StudyMateState>;
    /** 局面のノードごとの最短手順（求めたものだけ）。 */
    shortestResults: ReadonlyMap<string, StudyShortestState>;
    /** いま調べている局面（詰み・詰めろか最短手順。無ければ null）。 */
    runningNodeId: string | null;
    /** いま調べているもの（無ければ null）。 */
    runningKind: "mate" | "shortest" | null;
    start: (node: KifuNode) => void;
    /** 詰みのある局面の最短手順を求める。 */
    startShortest: (node: KifuNode) => void;
    /** 詰み・詰めろも最短手順も、動いているほうを止める。 */
    stop: () => void;
}

interface UseStudyMateOptions {
    engineOption: EngineOption | undefined;
    /** 置換表の大きさ (MB)。スマートフォンでは小さくする。 */
    hashMb: number;
}

/** 調べている実行。取り消したときに戻す結果を持つ。 */
type ActiveRun = { nodeId: string; engineId: string } & (
    | { kind: "mate"; previous: StudyMateState | undefined }
    | {
          kind: "shortest";
          previous: StudyShortestState | undefined;
          /** いままでに分かった手順と経過（中止しても、分かった手順は正しいので残す）。 */
          line: StudyShortestLine | null;
          elapsedMs: number;
      }
);

/** 調べ終わる前に中止・アンマウントされた。 */
class StudyMateCancelled extends Error {}

/** そのまま画面に出せる理由（このエンジンでは詰み探索を使えない、など）。 */
class StudyMateUnavailable extends Error {}

// エンジンの内部の言葉は出さない。開いたままのページでアプリが更新されるなどで起きるので、読み込み直しを促す。
function studyMateErrorMessage(error: unknown): string {
    if (error instanceof StudyMateUnavailable) return error.message;
    console.error("[study] 詰み探索に失敗しました:", error);
    return "詰み探索を始められませんでした。ページを読み込み直してから、もう一度お試しください。";
}

export function useStudyMate({ engineOption, hashMb }: UseStudyMateOptions): StudyMateController {
    const [results, setResults] = useState<ReadonlyMap<string, StudyMateState>>(new Map());
    const [shortestResults, setShortestResults] = useState<ReadonlyMap<string, StudyShortestState>>(
        new Map(),
    );
    const [running, setRunning] = useState<{
        nodeId: string;
        kind: "mate" | "shortest";
    } | null>(null);
    /** 実行の世代。開始・中止・エンジンの変更・アンマウントのたびに進め、古い実行の続きを捨てる。 */
    const runRef = useRef(0);
    const clientRef = useRef<EngineClient | null>(null);
    /** 調べている実行（同時に動かすのは 1 つだけ）。 */
    const activeRef = useRef<ActiveRun | null>(null);

    const supported = engineOption?.supportsMate === true;

    const setResult = (nodeId: string, state: StudyMateState): void => {
        setResults((previous) => new Map(previous).set(nodeId, state));
    };
    const setShortest = (nodeId: string, state: StudyShortestState): void => {
        setShortestResults((previous) => new Map(previous).set(nodeId, state));
    };

    const disposeClient = (): void => {
        const client = clientRef.current;
        clientRef.current = null;
        if (client) void client.dispose();
    };

    /**
     * 調べている実行を取り消す（世代を進め、エンジンを捨てる）。詰み・詰めろは途中の表示を調べる前の
     * 結果に戻し、最短手順は分かった手順があれば求め終わっていない結果として残す。
     */
    const cancelActive = (): void => {
        const active = activeRef.current;
        activeRef.current = null;
        runRef.current++;
        disposeClient();
        setRunning(null);
        if (!active) return;
        if (active.kind === "shortest" && active.line) {
            setShortest(active.nodeId, {
                status: "done",
                line: active.line,
                elapsedMs: active.elapsedMs,
            });
            return;
        }
        const restore = <T>(previous: ReadonlyMap<string, T>, value: T | undefined) => {
            const next = new Map(previous);
            if (value) next.set(active.nodeId, value);
            else next.delete(active.nodeId);
            return next;
        };
        if (active.kind === "mate") setResults((previous) => restore(previous, active.previous));
        else setShortestResults((previous) => restore(previous, active.previous));
    };
    const cancelActiveEvent = useEffectEvent(cancelActive);

    // エンジンが変わった・画面を閉じたら、そのエンジンで調べている途中の実行を取り消す
    const engineId = engineOption?.id ?? null;
    useEffect(
        () => () => {
            if (activeRef.current?.engineId === engineId) cancelActiveEvent();
        },
        [engineId],
    );

    /**
     * エンジンを作って実行を始める。始められなければ null（作れなかったときは `onError` に理由を渡す）。
     * `active` は作ったエンジンの id を添えて、調べている実行として覚える。
     */
    const beginRun = (
        node: KifuNode,
        active: (engineId: string) => ActiveRun,
        onError: (message: string) => void,
    ): { client: EngineClient; run: number } | null => {
        const option = engineOption;
        // 同じ描画の間に続けて呼ばれても二重に始めないよう、同期で書き換わる ref で確かめる
        if (!option || !supported || activeRef.current !== null) return null;
        const run = ++runRef.current;
        let client: EngineClient;
        try {
            client = option.createClient();
        } catch (error) {
            onError(studyMateErrorMessage(error));
            return null;
        }
        clientRef.current = client;
        const started = active(option.id);
        activeRef.current = started;
        setRunning({ nodeId: node.id, kind: started.kind });
        return { client, run };
    };

    /** 通常の探索の置換表は使わないので最小にして起動し、詰み探索を使えるか確かめる。 */
    const initClient = async (client: EngineClient, checkCurrent: () => void): Promise<void> => {
        await client.init({ ttSizeMb: 1 });
        checkCurrent();
        if (!client.mate?.available()) {
            throw new StudyMateUnavailable("このエンジンでは詰み探索を使えません");
        }
    };

    /** 終わった実行を片付ける（取り消された実行は、取り消した側が片付けている）。 */
    const finishRun = (run: number): void => {
        if (runRef.current !== run) return;
        activeRef.current = null;
        setRunning(null);
        disposeClient();
    };

    const start = (node: KifuNode): void => {
        const nodeId = node.id;
        const before = results.get(nodeId);
        const begun = beginRun(
            node,
            (engineId) => ({ kind: "mate", nodeId, engineId, previous: before }),
            (message) => setResult(nodeId, { status: "error", message }),
        );
        if (!begun) return;
        const { client, run } = begun;
        const checkCurrent = (): void => {
            if (runRef.current !== run) throw new StudyMateCancelled();
        };
        const previous = before?.status === "done" ? before : undefined;
        setResult(nodeId, { status: "running", phase: "mate", nodes: 0, elapsedMs: 0, previous });
        const solve = async (
            sfen: string,
            phase: "mate" | "threat",
            mode: MateMode,
        ): Promise<MateOutcome> => {
            await client.loadPosition(sfen, []);
            checkCurrent();
            if (!client.mate)
                throw new StudyMateUnavailable("このエンジンでは詰み探索を使えません");
            const outcome = await client.mate.solve(
                { mode, threads: MATE_THREADS, hashMb, timeMs: STUDY_MATE_TIME_MS },
                (progress) => {
                    if (runRef.current === run) {
                        setResult(nodeId, { status: "running", phase, ...progress, previous });
                    }
                },
            );
            checkCurrent();
            return outcome;
        };

        void (async () => {
            try {
                await initClient(client, checkCurrent);
                // 詰みは局面だけで決まる（それまでの手順は見ない）ので、局面を SFEN にして渡す
                const mateOutcome = await solve(
                    positionToSfen(node.positionAfter),
                    "mate",
                    "Power",
                );
                const mate = mateOutcome.result;
                let threat: MateResult | null = null;
                let threatMs: number | null = null;
                if (mate.kind !== "mate") {
                    setResult(nodeId, {
                        status: "running",
                        phase: "threat",
                        nodes: 0,
                        elapsedMs: 0,
                        previous,
                    });
                    // 詰めろは不詰のことが多いので、不詰の判定が速い Speed で読む
                    const outcome = await solve(threatSfen(node), "threat", "Speed");
                    // 王手されている局面は手番を渡せない。手番側の玉が無い局面（詰将棋の攻め方）は
                    // 詰まされることが無い。どちらもエンジンは扱えない局面として返す
                    if (outcome.result.kind !== "unsupported") {
                        threat = outcome.result;
                        threatMs = outcome.elapsedMs;
                    }
                }
                setResult(nodeId, {
                    status: "done",
                    mate,
                    mateMs: mateOutcome.elapsedMs,
                    threat,
                    threatMs,
                });
            } catch (error) {
                if (error instanceof StudyMateCancelled || runRef.current !== run) return;
                setResult(nodeId, { status: "error", message: studyMateErrorMessage(error) });
            } finally {
                finishRun(run);
            }
        })();
    };

    const startShortest = (node: KifuNode): void => {
        const nodeId = node.id;
        const before = shortestResults.get(nodeId);
        const begun = beginRun(
            node,
            (engineId) => ({
                kind: "shortest",
                nodeId,
                engineId,
                previous: before,
                line: null,
                elapsedMs: 0,
            }),
            (message) => setShortest(nodeId, { status: "error", message }),
        );
        if (!begun) return;
        const { client, run } = begun;
        const checkCurrent = (): void => {
            if (runRef.current !== run) throw new StudyMateCancelled();
        };
        /** この実行がまだ続いていれば、調べている実行の記録を返す。 */
        const current = (): (ActiveRun & { kind: "shortest" }) | null => {
            const active = activeRef.current;
            return runRef.current === run && active?.kind === "shortest" ? active : null;
        };
        setShortest(nodeId, { status: "running", nodes: 0, elapsedMs: 0, line: null });

        void (async () => {
            try {
                await initClient(client, checkCurrent);
                await client.loadPosition(positionToSfen(node.positionAfter), []);
                checkCurrent();
                if (!client.mate)
                    throw new StudyMateUnavailable("このエンジンでは詰み探索を使えません");
                let nodes = 0;
                const outcome = await client.mate.solve(
                    {
                        mode: "Power",
                        threads: MATE_THREADS,
                        hashMb,
                        timeMs: STUDY_SHORTEST_MATE_TIME_MS,
                        shortest: "tsume",
                    },
                    (progress) => {
                        const active = current();
                        if (!active) return;
                        nodes = progress.nodes;
                        active.elapsedMs = progress.elapsedMs;
                        setShortest(nodeId, { status: "running", ...progress, line: active.line });
                    },
                    (line: MateLine) => {
                        const active = current();
                        if (!active) return;
                        active.line = { stage: line.kind, pv: line.pv };
                        setShortest(nodeId, {
                            status: "running",
                            nodes,
                            elapsedMs: active.elapsedMs,
                            line: active.line,
                        });
                    },
                );
                const active = current();
                checkCurrent();
                const { result, elapsedMs } = outcome;
                if (result.kind === "mate") {
                    setShortest(nodeId, {
                        status: "done",
                        line: { stage: "proven", pv: result.pv },
                        elapsedMs,
                    });
                } else if (result.kind === "unknown") {
                    setShortest(nodeId, { status: "done", line: active?.line ?? null, elapsedMs });
                } else {
                    // 詰みのある局面から始めるので、不詰・扱えない局面は返らないはず
                    throw new Error(`unexpected shortest mate result: ${result.kind}`);
                }
            } catch (error) {
                if (error instanceof StudyMateCancelled || runRef.current !== run) return;
                setShortest(nodeId, { status: "error", message: studyMateErrorMessage(error) });
            } finally {
                finishRun(run);
            }
        })();
    };

    const stop = (): void => {
        // 詰み探索は途中で止められないので、エンジンを捨てて止める
        if (activeRef.current !== null) cancelActive();
    };

    return {
        supported,
        results,
        shortestResults,
        runningNodeId: running?.nodeId ?? null,
        runningKind: running?.kind ?? null,
        start,
        startShortest,
        stop,
    };
}

/** 手番を相手に渡した局面（いまの手番側に詰めろが掛かっているかを調べる）。 */
function threatSfen(node: KifuNode): string {
    const position = node.positionAfter;
    return positionToSfen({
        ...position,
        turn: position.turn === "sente" ? "gote" : "sente",
    });
}
