import type { EngineClient, MateParams, MateResult } from "@shogi/engine-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EngineOption } from "../shogi-match/types";
import { createTestStudy, TEST_LAYER_ID } from "./study-test-support";
import { buildStudyViewTree } from "./studyView";
import { useStudyMate } from "./useStudyMate";

/** 読み込んだ局面ごとに決めた結果を返す詰み探索のエンジン。 */
function createMateEngine(resultFor: (sfen: string, moves: string[]) => MateResult) {
    const loads: Array<{ sfen: string; moves: string[] }> = [];
    const solves: MateParams[] = [];
    const disposed = vi.fn();
    let pending: { resolve: () => void } | null = null;
    let hold = false;
    const createClient = (): EngineClient => {
        let loaded = { sfen: "", moves: [] as string[] };
        return {
            init: vi.fn().mockResolvedValue(undefined),
            loadPosition: vi.fn(async (sfen: string, moves: string[] = []) => {
                loaded = { sfen, moves };
                loads.push(loaded);
            }),
            setOption: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn(async () => disposed()),
            subscribe: () => () => {},
            search: vi.fn(),
            mate: {
                available: () => true,
                async solve(params) {
                    solves.push(params);
                    if (hold) await new Promise<void>((resolve) => (pending = { resolve }));
                    return {
                        result: resultFor(loaded.sfen, loaded.moves),
                        nodes: 1,
                        elapsedMs: 1,
                    };
                },
            },
        };
    };
    const option: EngineOption = {
        id: "wasm",
        label: "内蔵エンジン",
        createClient,
        kind: "internal",
        supportsMate: true,
    };
    return {
        option,
        loads,
        solves,
        disposed,
        holdSolves: () => {
            hold = true;
        },
        release: () => pending?.resolve(),
    };
}

const MATE: MateResult = { kind: "mate", pv: ["G*5b"] };
const NO_MATE: MateResult = { kind: "noMate" };
const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
/** 詰みは本譜の手順つきで、詰めろは手番を替えた局面だけで読む。 */
const isMatePhase = (moves: string[]) => moves.length > 0;

function setup(resultFor: (sfen: string, moves: string[]) => MateResult) {
    const { doc, ids } = createTestStudy();
    const { tree } = buildStudyViewTree(doc, TEST_LAYER_ID);
    const engine = createMateEngine(resultFor);
    const hook = renderHook(() => useStudyMate({ tree, engineOption: engine.option, hashMb: 16 }));
    return { ids, engine, hook };
}

describe("useStudyMate", () => {
    it("手番側に詰みがあれば、詰めろは調べない", async () => {
        const { ids, engine, hook } = setup(() => MATE);
        act(() => hook.result.current.start(ids[2]));
        await waitFor(() =>
            expect(hook.result.current.results.get(ids[2])).toEqual({
                status: "done",
                mate: MATE,
                threat: null,
            }),
        );
        expect(engine.loads).toEqual([{ sfen: HIRATE, moves: ["7g7f", "3c3d"] }]);
        expect(engine.solves[0]).toMatchObject({ mode: "Power", hashMb: 16 });
        expect(hook.result.current.runningNodeId).toBeNull();
    });

    it("詰みが無ければ、手番を相手に渡した局面で詰めろを調べる", async () => {
        const { ids, engine, hook } = setup((_, moves) => (isMatePhase(moves) ? NO_MATE : MATE));
        act(() => hook.result.current.start(ids[2]));
        await waitFor(() =>
            expect(hook.result.current.results.get(ids[2])).toEqual({
                status: "done",
                mate: NO_MATE,
                threat: MATE,
            }),
        );
        // ▲7六歩 △3四歩 の後は先手番。手番だけを後手に替えた局面を読む
        expect(engine.loads[1]).toEqual({
            sfen: "lnsgkgsnl/1r5b1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 1",
            moves: [],
        });
    });

    it("王手されていて手番を渡せない局面では、詰めろを出さない", async () => {
        const { ids, hook } = setup((_, moves) =>
            isMatePhase(moves) ? NO_MATE : { kind: "unsupported" },
        );
        act(() => hook.result.current.start(ids[1]));
        await waitFor(() =>
            expect(hook.result.current.results.get(ids[1])).toEqual({
                status: "done",
                mate: NO_MATE,
                threat: null,
            }),
        );
    });

    it("中止するとエンジンを捨て、結果を残さない", async () => {
        const { ids, engine, hook } = setup(() => MATE);
        engine.holdSolves();
        act(() => hook.result.current.start(ids[1]));
        await waitFor(() => expect(engine.solves).toHaveLength(1));
        expect(hook.result.current.runningNodeId).toBe(ids[1]);
        act(() => hook.result.current.stop());
        expect(engine.disposed).toHaveBeenCalled();
        expect(hook.result.current.runningNodeId).toBeNull();
        expect(hook.result.current.results.has(ids[1])).toBe(false);
        // 止めた探索が後から返っても、結果にしない
        await act(async () => engine.release());
        expect(hook.result.current.results.has(ids[1])).toBe(false);
    });

    it("詰み探索を持たないエンジンでは使えない", () => {
        const { doc } = createTestStudy();
        const { tree } = buildStudyViewTree(doc, TEST_LAYER_ID);
        const { result } = renderHook(() =>
            useStudyMate({
                tree,
                engineOption: {
                    id: "native",
                    label: "内蔵エンジン",
                    createClient: vi.fn(),
                    kind: "internal",
                },
                hashMb: 16,
            }),
        );
        expect(result.current.supported).toBe(false);
    });
});
