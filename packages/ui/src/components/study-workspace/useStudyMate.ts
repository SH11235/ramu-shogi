/**
 * 研究ノートの詰み探索。いま見ている局面について、手番側の詰みと、手番側に掛かっている詰めろ
 * （手番を相手に渡したら詰まされるか）を調べる。
 *
 * 解析（候補手）とは別のエンジンで解く。詰み探索の間は同じエンジンでほかの操作ができないので、
 * 解析のエンジンを借りると、全体の解析と取り合いになる。エンジンは調べるたびに作って捨てる
 * （詰み探索の置換表は数十 MB あり、スマートフォンで解析のエンジンと並べて持ち続けたくない）。
 * 結果は画面を開いている間だけ覚える。
 */

import { type KifuNode, positionToSfen } from "@shogi/app-core";
import type { EngineClient, MateMode, MateResult } from "@shogi/engine-client";
import { useEffect, useRef, useState } from "react";
import type { EngineOption } from "../shogi-match/types";

/** 詰み・詰めろのそれぞれに掛ける時間の上限。 */
export const STUDY_MATE_TIME_MS = 10_000;
/** 1 局面を解くスレッド数（エンジンのスレッド数を上限に丸められる）。 */
const MATE_THREADS = 4;

export type StudyMateState =
    | {
          status: "running";
          /** いま調べているもの（詰み → 詰めろ の順）。 */
          phase: "mate" | "threat";
          nodes: number;
          elapsedMs: number;
      }
    | {
          status: "done";
          mate: MateResult;
          /**
           * 手番を相手に渡した局面の結果。手番側に詰みがあるとき・王手されているとき（手番を渡せない）は
           * 調べないので null。
           */
          threat: MateResult | null;
      }
    | { status: "error"; message: string };

export interface StudyMateController {
    /** 詰み探索を使えるか（使えるエンジンが無ければ false）。 */
    supported: boolean;
    /** 局面のノードごとの結果（調べたものだけ）。 */
    results: ReadonlyMap<string, StudyMateState>;
    /** いま調べている局面（無ければ null）。 */
    runningNodeId: string | null;
    start: (node: KifuNode) => void;
    stop: () => void;
}

interface UseStudyMateOptions {
    engineOption: EngineOption | undefined;
    /** 置換表の大きさ (MB)。スマートフォンでは小さくする。 */
    hashMb: number;
}

/** 調べ終わる前に中止・アンマウントされた。 */
class StudyMateCancelled extends Error {}

export function useStudyMate({ engineOption, hashMb }: UseStudyMateOptions): StudyMateController {
    const [results, setResults] = useState<ReadonlyMap<string, StudyMateState>>(new Map());
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    /** 実行の世代。開始・中止・アンマウントのたびに進め、古い実行の続きを捨てる。 */
    const runRef = useRef(0);
    const clientRef = useRef<EngineClient | null>(null);

    const supported = engineOption?.supportsMate === true;

    const setResult = (nodeId: string, state: StudyMateState): void => {
        setResults((previous) => new Map(previous).set(nodeId, state));
    };

    const disposeClient = (): void => {
        const client = clientRef.current;
        clientRef.current = null;
        if (client) void client.dispose();
    };

    // 画面を閉じたら、調べている途中のエンジンを捨てる
    useEffect(
        () => () => {
            runRef.current++;
            const client = clientRef.current;
            clientRef.current = null;
            if (client) void client.dispose();
        },
        [],
    );

    const start = (node: KifuNode): void => {
        const option = engineOption;
        if (!option || !supported || runningNodeId !== null) return;
        const nodeId = node.id;
        const run = ++runRef.current;
        const checkCurrent = (): void => {
            if (runRef.current !== run) throw new StudyMateCancelled();
        };
        setRunningNodeId(nodeId);
        setResult(nodeId, { status: "running", phase: "mate", nodes: 0, elapsedMs: 0 });

        const client = option.createClient();
        clientRef.current = client;
        const solve = async (
            sfen: string,
            phase: "mate" | "threat",
            mode: MateMode,
        ): Promise<MateResult> => {
            await client.loadPosition(sfen, []);
            checkCurrent();
            if (!client.mate) throw new Error("このエンジンでは詰み探索を使えません");
            const outcome = await client.mate.solve(
                { mode, threads: MATE_THREADS, hashMb, timeMs: STUDY_MATE_TIME_MS },
                (progress) => {
                    if (runRef.current === run) {
                        setResult(nodeId, { status: "running", phase, ...progress });
                    }
                },
            );
            checkCurrent();
            return outcome.result;
        };

        void (async () => {
            try {
                // 通常の探索の置換表は使わないので最小にする
                await client.init({ ttSizeMb: 1 });
                checkCurrent();
                if (!client.mate?.available()) {
                    throw new Error("このエンジンでは詰み探索を使えません");
                }
                // 詰みは局面だけで決まる（それまでの手順は見ない）ので、局面を SFEN にして渡す
                const mate = await solve(positionToSfen(node.positionAfter), "mate", "Power");
                let threat: MateResult | null = null;
                if (mate.kind !== "mate") {
                    setResult(nodeId, {
                        status: "running",
                        phase: "threat",
                        nodes: 0,
                        elapsedMs: 0,
                    });
                    // 詰めろは不詰のことが多いので、不詰の判定が速い Speed で読む
                    const result = await solve(threatSfen(node), "threat", "Speed");
                    // 王手されている局面は手番を渡せない（エンジンは扱えない局面として返す）
                    threat = result.kind === "unsupported" ? null : result;
                }
                setResult(nodeId, { status: "done", mate, threat });
            } catch (error) {
                if (error instanceof StudyMateCancelled || runRef.current !== run) return;
                setResult(nodeId, {
                    status: "error",
                    message: error instanceof Error ? error.message : String(error),
                });
            } finally {
                if (runRef.current === run) {
                    setRunningNodeId(null);
                    disposeClient();
                }
            }
        })();
    };

    const stop = (): void => {
        const nodeId = runningNodeId;
        if (nodeId === null) return;
        runRef.current++;
        setRunningNodeId(null);
        setResults((previous) => {
            const next = new Map(previous);
            next.delete(nodeId);
            return next;
        });
        // 詰み探索は途中で止められないので、エンジンを捨てて止める
        disposeClient();
    };

    return { supported, results, runningNodeId, start, stop };
}

/** 手番を相手に渡した局面（いまの手番側に詰めろが掛かっているかを調べる）。 */
function threatSfen(node: KifuNode): string {
    const position = node.positionAfter;
    return positionToSfen({
        ...position,
        turn: position.turn === "sente" ? "gote" : "sente",
    });
}
