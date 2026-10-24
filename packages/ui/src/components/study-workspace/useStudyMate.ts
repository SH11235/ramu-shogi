/**
 * 研究ノートの詰み探索。いま見ている局面について、手番側の詰みと、手番側に掛かっている詰めろ
 * （手番を相手に渡したら詰まされるか）を調べる。
 *
 * 解析（候補手）とは別のエンジンで解く。詰み探索の間は同じエンジンでほかの操作ができないので、
 * 解析のエンジンを借りると、全体の解析と取り合いになる。結果は画面を開いている間だけ覚える。
 */

import { isStudyPassMove, type KifuNode, type KifuTree, positionToSfen } from "@shogi/app-core";
import type { EngineClient, MateResult } from "@shogi/engine-client";
import { useEffect, useRef, useState } from "react";
import type { EngineOption } from "../shogi-match/types";
import { studyPathTo } from "./studyView";

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
    start: (nodeId: string) => void;
    stop: () => void;
}

interface UseStudyMateOptions {
    tree: KifuTree;
    engineOption: EngineOption | undefined;
    /** 置換表の大きさ (MB)。スマートフォンでは小さくする。 */
    hashMb: number;
}

export function useStudyMate({
    tree,
    engineOption,
    hashMb,
}: UseStudyMateOptions): StudyMateController {
    const [results, setResults] = useState<ReadonlyMap<string, StudyMateState>>(new Map());
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const clientRef = useRef<{ key: string; client: EngineClient } | null>(null);
    const runRef = useRef(0);

    const supported = engineOption?.supportsMate === true;

    const setResult = (nodeId: string, state: StudyMateState): void => {
        setResults((previous) => new Map(previous).set(nodeId, state));
    };

    const disposeClient = (): void => {
        const current = clientRef.current;
        clientRef.current = null;
        if (current) void current.client.dispose();
    };

    // エンジンが変わったら作り直す。画面を閉じたら捨てる。
    // biome-ignore lint/correctness/useExhaustiveDependencies: エンジンの id が変わったときだけ捨てる
    useEffect(() => disposeClient, [engineOption?.id]);

    const ensureClient = async (option: EngineOption): Promise<EngineClient> => {
        if (clientRef.current?.key !== option.id) {
            disposeClient();
            clientRef.current = { key: option.id, client: option.createClient() };
        }
        const { client } = clientRef.current;
        if (!client.mate) throw new Error("このエンジンでは詰み探索を使えません");
        await client.init();
        if (!client.mate.available()) throw new Error("このエンジンでは詰み探索を使えません");
        return client;
    };

    const start = (nodeId: string): void => {
        const option = engineOption;
        const node = tree.nodes.get(nodeId);
        if (!option || !supported || !node || runningNodeId !== null) return;
        const startSfen = tree.startSfen;
        const moves = studyPathTo(tree, nodeId)
            .map((id) => tree.nodes.get(id)?.usiMove)
            .filter((move): move is string => Boolean(move));
        if (moves.some((move) => isStudyPassMove(move))) {
            setResult(nodeId, {
                status: "error",
                message: "パスを含む局面は詰みを調べられません",
            });
            return;
        }
        const run = ++runRef.current;
        const isCurrent = () => runRef.current === run;
        setRunningNodeId(nodeId);
        setResult(nodeId, { status: "running", phase: "mate", nodes: 0, elapsedMs: 0 });
        void (async () => {
            try {
                const client = await ensureClient(option);
                const solve = async (phase: "mate" | "threat"): Promise<MateResult> => {
                    if (phase === "mate") {
                        await client.loadPosition(startSfen, moves);
                    } else {
                        await client.loadPosition(threatSfen(node), []);
                    }
                    const outcome = await client.mate?.solve(
                        {
                            mode: "Power",
                            threads: MATE_THREADS,
                            hashMb,
                            timeMs: STUDY_MATE_TIME_MS,
                        },
                        (progress) => {
                            if (!isCurrent()) return;
                            setResult(nodeId, { status: "running", phase, ...progress });
                        },
                    );
                    if (!outcome) throw new Error("このエンジンでは詰み探索を使えません");
                    return outcome.result;
                };
                const mate = await solve("mate");
                if (!isCurrent()) return;
                let threat: MateResult | null = null;
                if (mate.kind !== "mate") {
                    setResult(nodeId, {
                        status: "running",
                        phase: "threat",
                        nodes: 0,
                        elapsedMs: 0,
                    });
                    const result = await solve("threat");
                    // 王手されている局面は手番を渡せない（エンジンは扱えない局面として返す）
                    threat = result.kind === "unsupported" ? null : result;
                }
                if (!isCurrent()) return;
                setResult(nodeId, { status: "done", mate, threat });
            } catch (error) {
                if (!isCurrent()) return;
                setResult(nodeId, {
                    status: "error",
                    message: error instanceof Error ? error.message : String(error),
                });
            } finally {
                if (isCurrent()) setRunningNodeId(null);
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
        // 詰み探索は途中で止められないので、エンジンを捨てて止める（次に調べるときに作り直す）
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
