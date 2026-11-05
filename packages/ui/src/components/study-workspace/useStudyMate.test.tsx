import type { KifuNode } from "@shogi/app-core";
import type { EngineClient, MateLine, MateParams, MateResult } from "@shogi/engine-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EngineOption } from "../shogi-match/types";
import { createTestStudy, TEST_LAYER_ID } from "./study-test-support";
import { buildStudyViewTree } from "./studyView";
import { STUDY_SHORTEST_MATE_TIME_MS, useStudyMate } from "./useStudyMate";

/** ▲7六歩 △3四歩 の後 (先手番) の局面と、手番だけ後手に替えた局面。 */
const AFTER_TWO = "lnsgkgsnl/1r5b1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL b - 1";
const AFTER_TWO_PASSED = "lnsgkgsnl/1r5b1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 1";

const MATE: MateResult = { kind: "mate", pv: ["G*5b"] };
const NO_MATE: MateResult = { kind: "noMate" };

/**
 * 読み込んだ局面ごとに決めた結果を返す詰み探索のエンジン。`hold` の段階は `release` まで待つ。
 * 最短手順では `shortest.lines` を知らせてから待ち、`shortest.result` を返す。
 */
function createMateEngine(
    resultFor: (sfen: string) => MateResult,
    shortest: { lines: MateLine[]; result: MateResult } = { lines: [], result: MATE },
) {
    const loads: string[] = [];
    const solves: MateParams[] = [];
    const created: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    let holdAt: "init" | "solve" | null = null;
    let release: (() => void) | null = null;
    const wait = () =>
        new Promise<void>((resolve) => {
            release = resolve;
        });
    const createClient = (): EngineClient => {
        let loaded = "";
        const dispose = vi.fn().mockResolvedValue(undefined);
        created.push({ dispose });
        return {
            init: vi.fn(async () => {
                if (holdAt === "init") await wait();
            }),
            loadPosition: vi.fn(async (sfen: string) => {
                loaded = sfen;
                loads.push(sfen);
            }),
            setOption: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            dispose,
            subscribe: () => () => {},
            search: vi.fn(),
            mate: {
                available: () => true,
                async solve(params, onProgress, onLine) {
                    solves.push(params);
                    if (params.shortest) {
                        onProgress?.({ nodes: 7, elapsedMs: 1_000 });
                        for (const line of shortest.lines) onLine?.(line);
                        if (holdAt === "solve") await wait();
                        return { result: shortest.result, nodes: 9, elapsedMs: 3_000 };
                    }
                    if (holdAt === "solve") {
                        await wait();
                        onProgress?.({ nodes: 5, elapsedMs: 5 });
                    }
                    return { result: resultFor(loaded), nodes: 1, elapsedMs: 1 };
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
        created,
        hold: (at: "init" | "solve") => {
            holdAt = at;
        },
        release: () => release?.(),
    };
}

function setup(
    resultFor: (sfen: string) => MateResult,
    shortest?: { lines: MateLine[]; result: MateResult },
) {
    const { doc, ids } = createTestStudy();
    const { tree } = buildStudyViewTree(doc, TEST_LAYER_ID);
    const node = (index: number): KifuNode => {
        const found = tree.nodes.get(ids[index]);
        if (!found) throw new Error(`node ${index}`);
        return found;
    };
    const engine = createMateEngine(resultFor, shortest);
    const hook = renderHook(() => useStudyMate({ engineOption: engine.option, hashMb: 16 }));
    return { node, engine, hook };
}

describe("useStudyMate", () => {
    it("手番側に詰みがあれば、詰めろは調べない。終わったらエンジンを捨てる", async () => {
        const { node, engine, hook } = setup(() => MATE);
        act(() => hook.result.current.start(node(2)));
        await waitFor(() =>
            expect(hook.result.current.results.get(node(2).id)).toEqual({
                status: "done",
                mate: MATE,
                mateMs: 1,
                threat: null,
                threatMs: null,
            }),
        );
        expect(engine.loads).toEqual([AFTER_TWO]);
        expect(engine.solves[0]).toMatchObject({ mode: "Power", hashMb: 16 });
        expect(hook.result.current.runningNodeId).toBeNull();
        expect(engine.created[0].dispose).toHaveBeenCalled();
    });

    it("詰みが無ければ、手番を相手に渡した局面で詰めろを調べる", async () => {
        const { node, engine, hook } = setup((sfen) => (sfen === AFTER_TWO ? NO_MATE : MATE));
        act(() => hook.result.current.start(node(2)));
        await waitFor(() =>
            expect(hook.result.current.results.get(node(2).id)).toEqual({
                status: "done",
                mate: NO_MATE,
                mateMs: 1,
                threat: MATE,
                threatMs: 1,
            }),
        );
        expect(engine.loads).toEqual([AFTER_TWO, AFTER_TWO_PASSED]);
        expect(engine.solves[1]).toMatchObject({ mode: "Speed" });
    });

    it("エンジンが手番を渡した局面を扱えない (王手されている) ときは、詰めろを出さない", async () => {
        const { node, hook } = setup((sfen) =>
            sfen === AFTER_TWO ? NO_MATE : { kind: "unsupported" },
        );
        act(() => hook.result.current.start(node(2)));
        await waitFor(() =>
            expect(hook.result.current.results.get(node(2).id)).toEqual({
                status: "done",
                mate: NO_MATE,
                mateMs: 1,
                threat: null,
                threatMs: null,
            }),
        );
    });

    it("エンジンが失敗したときは、内部の言葉を出さずに読み込み直しを促す", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const { node, hook } = setup(() => {
            throw new Error("worker replaced");
        });
        act(() => hook.result.current.start(node(2)));
        await waitFor(() =>
            expect(hook.result.current.results.get(node(2).id)).toEqual({
                status: "error",
                message:
                    "詰み探索を始められませんでした。ページを読み込み直してから、もう一度お試しください。",
            }),
        );
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it("エンジンを作れないときも、内部の言葉を出さずに読み込み直しを促す", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const { node } = setup(() => MATE);
        const option: EngineOption = {
            id: "wasm",
            label: "内蔵エンジン",
            kind: "internal",
            supportsMate: true,
            createClient: () => {
                throw new Error("Worker is not defined");
            },
        };
        const hook = renderHook(() => useStudyMate({ engineOption: option, hashMb: 16 }));
        act(() => hook.result.current.start(node(2)));
        expect(hook.result.current.results.get(node(2).id)).toEqual({
            status: "error",
            message:
                "詰み探索を始められませんでした。ページを読み込み直してから、もう一度お試しください。",
        });
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it("このエンジンで詰み探索を使えないときは、そう伝える", async () => {
        const { node, engine } = setup(() => MATE);
        const option: EngineOption = {
            ...engine.option,
            createClient: () => {
                const client = engine.option.createClient();
                return {
                    ...client,
                    mate: client.mate && { ...client.mate, available: () => false },
                };
            },
        };
        const hook = renderHook(() => useStudyMate({ engineOption: option, hashMb: 16 }));
        act(() => hook.result.current.start(node(2)));
        await waitFor(() =>
            expect(hook.result.current.results.get(node(2).id)).toEqual({
                status: "error",
                message: "このエンジンでは詰み探索を使えません",
            }),
        );
    });

    it("調べている間は、別の局面で始めても無視する", async () => {
        const { node, engine, hook } = setup(() => MATE);
        engine.hold("solve");
        act(() => hook.result.current.start(node(1)));
        await waitFor(() => expect(engine.solves).toHaveLength(1));
        act(() => hook.result.current.start(node(2)));
        expect(engine.created).toHaveLength(1);
        expect(hook.result.current.runningNodeId).toBe(node(1).id);
    });

    it.each([
        "init",
        "solve",
    ] as const)("中止するとエンジンを捨て、後から返った結果・途中経過を残さない (%s の途中)", async (at) => {
        const { node, engine, hook } = setup(() => MATE);
        engine.hold(at);
        act(() => hook.result.current.start(node(1)));
        await waitFor(() => expect(engine.created).toHaveLength(1));
        if (at === "solve") await waitFor(() => expect(engine.solves).toHaveLength(1));
        act(() => hook.result.current.stop());
        expect(engine.created[0].dispose).toHaveBeenCalled();
        expect(hook.result.current.runningNodeId).toBeNull();
        await act(async () => engine.release());
        expect(hook.result.current.results.has(node(1).id)).toBe(false);
        // 中止した後は、エンジンを使い続けない
        expect(engine.solves).toHaveLength(at === "solve" ? 1 : 0);
    });

    it("結果のある局面を調べ直して中止すると、前の結果に戻す", async () => {
        const { node, engine, hook } = setup(() => MATE);
        act(() => hook.result.current.start(node(1)));
        const done = { status: "done", mate: MATE, mateMs: 1, threat: null, threatMs: null };
        await waitFor(() => expect(hook.result.current.results.get(node(1).id)).toEqual(done));
        engine.hold("solve");
        act(() => hook.result.current.start(node(1)));
        await waitFor(() => expect(engine.solves).toHaveLength(2));
        act(() => hook.result.current.stop());
        expect(hook.result.current.results.get(node(1).id)).toEqual(done);
        await act(async () => engine.release());
        expect(hook.result.current.results.get(node(1).id)).toEqual(done);
    });

    it("画面を閉じると、調べている途中のエンジンを捨てる", async () => {
        const { node, engine, hook } = setup(() => MATE);
        engine.hold("solve");
        act(() => hook.result.current.start(node(1)));
        await waitFor(() => expect(engine.solves).toHaveLength(1));
        hook.unmount();
        expect(engine.created[0].dispose).toHaveBeenCalled();
    });

    it("エンジンが変わったら、前のエンジンで調べている途中の実行を取り消す", async () => {
        const { doc, ids } = createTestStudy();
        const { tree } = buildStudyViewTree(doc, TEST_LAYER_ID);
        const node = tree.nodes.get(ids[1]);
        if (!node) throw new Error("node");
        const engine = createMateEngine(() => MATE);
        engine.hold("solve");
        const other = createMateEngine(() => MATE).option;
        const hook = renderHook(
            ({ option }) => useStudyMate({ engineOption: option, hashMb: 16 }),
            { initialProps: { option: engine.option } },
        );
        act(() => hook.result.current.start(node));
        await waitFor(() => expect(engine.solves).toHaveLength(1));
        hook.rerender({ option: { ...other, id: "wasm-2" } });
        expect(engine.created[0].dispose).toHaveBeenCalled();
        expect(hook.result.current.runningNodeId).toBeNull();
        await act(async () => engine.release());
        expect(hook.result.current.results.has(node.id)).toBe(false);
    });

    it("詰み探索を持たないエンジンでは使えない", () => {
        const { result } = renderHook(() =>
            useStudyMate({
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

    describe("最短手順", () => {
        const ESTIMATED: MateLine = { kind: "estimated", pv: ["G*5b", "5a4a", "G*4b"] };
        const BOUNDED: MateLine = { kind: "bounded", pv: ["G*5b"] };

        it("途中で分かった手順を出し、最短を証明したら証明済みの手順にする", async () => {
            const { node, engine, hook } = setup(() => MATE, {
                lines: [ESTIMATED, BOUNDED],
                result: MATE,
            });
            engine.hold("solve");
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() =>
                expect(hook.result.current.shortestResults.get(node(2).id)).toEqual({
                    status: "running",
                    nodes: 7,
                    elapsedMs: 1_000,
                    line: { stage: "bounded", pv: ["G*5b"] },
                }),
            );
            expect(hook.result.current.runningNodeId).toBe(node(2).id);
            expect(hook.result.current.runningKind).toBe("shortest");
            expect(engine.loads).toEqual([AFTER_TWO]);
            expect(engine.solves[0]).toMatchObject({
                mode: "Power",
                hashMb: 16,
                timeMs: STUDY_SHORTEST_MATE_TIME_MS,
                shortest: "tsume",
            });
            await act(async () => engine.release());
            await waitFor(() =>
                expect(hook.result.current.shortestResults.get(node(2).id)).toEqual({
                    status: "done",
                    line: { stage: "proven", pv: ["G*5b"] },
                    elapsedMs: 3_000,
                }),
            );
            expect(hook.result.current.runningKind).toBeNull();
            expect(engine.created[0].dispose).toHaveBeenCalled();
            // 詰み・詰めろの結果とは別に覚える
            expect(hook.result.current.results.has(node(2).id)).toBe(false);
        });

        it("時間内に求め終わらなければ、分かったところまでの手順を残す", async () => {
            const { node, hook } = setup(() => MATE, {
                lines: [ESTIMATED],
                result: { kind: "unknown" },
            });
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() =>
                expect(hook.result.current.shortestResults.get(node(2).id)).toEqual({
                    status: "done",
                    line: { stage: "estimated", pv: ESTIMATED.pv },
                    elapsedMs: 3_000,
                }),
            );
        });

        it("中止しても分かった手順は残し、後から返った結果は捨てる", async () => {
            const { node, engine, hook } = setup(() => MATE, {
                lines: [ESTIMATED],
                result: MATE,
            });
            engine.hold("solve");
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() =>
                expect(hook.result.current.shortestResults.get(node(2).id)).toMatchObject({
                    status: "running",
                    line: { stage: "estimated" },
                }),
            );
            act(() => hook.result.current.stop());
            const stopped = {
                status: "done",
                line: { stage: "estimated", pv: ESTIMATED.pv },
                elapsedMs: 1_000,
            };
            expect(hook.result.current.shortestResults.get(node(2).id)).toEqual(stopped);
            expect(hook.result.current.runningNodeId).toBeNull();
            expect(engine.created[0].dispose).toHaveBeenCalled();
            await act(async () => engine.release());
            expect(hook.result.current.shortestResults.get(node(2).id)).toEqual(stopped);
        });

        it("手順が分かる前に中止したら、何も残さない", async () => {
            const { node, engine, hook } = setup(() => MATE);
            engine.hold("init");
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.created).toHaveLength(1));
            act(() => hook.result.current.stop());
            await act(async () => engine.release());
            expect(hook.result.current.shortestResults.has(node(2).id)).toBe(false);
            expect(engine.solves).toHaveLength(0);
        });

        it("詰み探索の途中では始めない", async () => {
            const { node, engine, hook } = setup(() => MATE);
            engine.hold("solve");
            act(() => hook.result.current.start(node(2)));
            await waitFor(() => expect(engine.solves).toHaveLength(1));
            act(() => hook.result.current.startShortest(node(2)));
            expect(engine.created).toHaveLength(1);
            expect(hook.result.current.runningKind).toBe("mate");
        });

        /** solve ごとに途中の通知と結果を外から送れるエンジン。 */
        function createControlledEngine(id = "wasm") {
            const calls: Array<{
                params: MateParams;
                onProgress?: (progress: { nodes: number; elapsedMs: number }) => void;
                onLine?: (line: MateLine) => void;
                finish: (result: MateResult) => void;
                fail: (error: Error) => void;
            }> = [];
            const disposed: Array<ReturnType<typeof vi.fn>> = [];
            const option: EngineOption = {
                id,
                label: "内蔵エンジン",
                kind: "internal",
                supportsMate: true,
                createClient: () => {
                    const dispose = vi.fn().mockResolvedValue(undefined);
                    disposed.push(dispose);
                    return {
                        init: vi.fn().mockResolvedValue(undefined),
                        loadPosition: vi.fn().mockResolvedValue(undefined),
                        setOption: vi.fn().mockResolvedValue(undefined),
                        stop: vi.fn().mockResolvedValue(undefined),
                        dispose,
                        subscribe: () => () => {},
                        search: vi.fn(),
                        mate: {
                            available: () => true,
                            solve: (params, onProgress, onLine) =>
                                new Promise((resolve, reject) => {
                                    calls.push({
                                        fail: reject,
                                        params,
                                        onProgress,
                                        onLine,
                                        finish: (result) =>
                                            resolve({ result, nodes: 9, elapsedMs: 3_000 }),
                                    });
                                }),
                        },
                    };
                },
            };
            return { option, calls, disposed };
        }

        function setupControlled() {
            const { node } = setup(() => MATE);
            const engine = createControlledEngine();
            const hook = renderHook(
                ({ option }) => useStudyMate({ engineOption: option, hashMb: 16 }),
                { initialProps: { option: engine.option } },
            );
            return { node, engine, hook };
        }

        it("中止した実行の途中の通知・結果が後から届いても、次の実行を変えない", async () => {
            const { node, engine, hook } = setupControlled();
            act(() => hook.result.current.startShortest(node(1)));
            await waitFor(() => expect(engine.calls).toHaveLength(1));
            act(() => hook.result.current.stop());
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(2));
            const [first] = engine.calls;
            await act(async () => {
                first.onProgress?.({ nodes: 99, elapsedMs: 9_000 });
                first.onLine?.(BOUNDED);
                first.finish(MATE);
            });
            expect(hook.result.current.shortestResults.get(node(2).id)).toEqual({
                status: "running",
                nodes: 0,
                elapsedMs: 0,
                line: null,
            });
            expect(hook.result.current.shortestResults.has(node(1).id)).toBe(false);
            expect(hook.result.current.runningNodeId).toBe(node(2).id);
        });

        it("求めている途中でエンジンが変わったら取り消し、分かった手順は残す", async () => {
            const { node, engine, hook } = setupControlled();
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(1));
            act(() => engine.calls[0].onLine?.(ESTIMATED));
            hook.rerender({ option: createControlledEngine("wasm-2").option });
            expect(engine.disposed[0]).toHaveBeenCalled();
            expect(hook.result.current.runningNodeId).toBeNull();
            await act(async () => engine.calls[0].finish(MATE));
            expect(hook.result.current.shortestResults.get(node(2).id)).toMatchObject({
                status: "done",
                line: { stage: "estimated" },
            });
        });

        it("求めている途中で画面を閉じると、エンジンを捨てる", async () => {
            const { node, engine, hook } = setupControlled();
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(1));
            hook.unmount();
            expect(engine.disposed[0]).toHaveBeenCalled();
        });

        it("前の結果がある局面を調べ直して、前より進まないうちに中止すると前の結果に戻す", async () => {
            const { node, engine, hook } = setupControlled();
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(1));
            act(() => engine.calls[0].onLine?.(BOUNDED));
            await act(async () => engine.calls[0].finish({ kind: "unknown" }));
            const previous = {
                status: "done",
                line: { stage: "bounded", pv: BOUNDED.pv },
                elapsedMs: 3_000,
            };
            expect(hook.result.current.shortestResults.get(node(2).id)).toEqual(previous);
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(2));
            expect(hook.result.current.shortestResults.get(node(2).id)).toMatchObject({
                status: "running",
                line: null,
                previous,
            });
            act(() => engine.calls[1].onLine?.(ESTIMATED));
            act(() => hook.result.current.stop());
            expect(hook.result.current.shortestResults.get(node(2).id)).toEqual(previous);
        });

        it("調べ直して前より進まないまま時間切れになったら、前の結果を残す", async () => {
            const { node, engine, hook } = setupControlled();
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(1));
            act(() => engine.calls[0].onLine?.(BOUNDED));
            await act(async () => engine.calls[0].finish({ kind: "unknown" }));
            const previous = hook.result.current.shortestResults.get(node(2).id);
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(2));
            act(() => engine.calls[1].onLine?.(ESTIMATED));
            await act(async () => engine.calls[1].finish({ kind: "unknown" }));
            expect(hook.result.current.shortestResults.get(node(2).id)).toBe(previous);
        });

        it("調べ直して前より進んだところで中止したら、進んだ手順を残す", async () => {
            const { node, engine, hook } = setupControlled();
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(1));
            act(() => engine.calls[0].onLine?.(ESTIMATED));
            await act(async () => engine.calls[0].finish({ kind: "unknown" }));
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(2));
            act(() => engine.calls[1].onLine?.(BOUNDED));
            act(() => hook.result.current.stop());
            expect(hook.result.current.shortestResults.get(node(2).id)).toMatchObject({
                status: "done",
                line: { stage: "bounded", pv: BOUNDED.pv },
            });
        });

        it("手順が届いた後に失敗したら、分かった手順を残して理由を添える", async () => {
            const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
            const { node, engine, hook } = setupControlled();
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(1));
            act(() => engine.calls[0].onLine?.(ESTIMATED));
            await act(async () => engine.calls[0].fail(new Error("worker replaced")));
            expect(hook.result.current.shortestResults.get(node(2).id)).toMatchObject({
                status: "done",
                line: { stage: "estimated", pv: ESTIMATED.pv },
                message: expect.stringContaining("読み込み直して"),
            });
            consoleError.mockRestore();
        });

        it("調べ直しが前より弱い手順のまま失敗したら、前の手順を残して理由を添える", async () => {
            const { node, engine, hook } = setupControlled();
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(1));
            act(() => engine.calls[0].onLine?.(BOUNDED));
            await act(async () => engine.calls[0].finish({ kind: "unknown" }));
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(2));
            act(() => engine.calls[1].onLine?.(ESTIMATED));
            await act(async () => engine.calls[1].finish({ kind: "noMate" }));
            expect(hook.result.current.shortestResults.get(node(2).id)).toEqual({
                status: "done",
                line: { stage: "bounded", pv: BOUNDED.pv },
                elapsedMs: 3_000,
                message: "最短手順を求められませんでした",
            });
        });

        it("最初の判定と食い違う結果は、読み込み直しを促さずに求められなかったと伝える", async () => {
            const consoleError = vi.spyOn(console, "error");
            const { node, engine, hook } = setupControlled();
            act(() => hook.result.current.startShortest(node(2)));
            await waitFor(() => expect(engine.calls).toHaveLength(1));
            await act(async () => engine.calls[0].finish({ kind: "noMate" }));
            expect(hook.result.current.shortestResults.get(node(2).id)).toEqual({
                status: "error",
                message: "最短手順を求められませんでした",
            });
            expect(consoleError).not.toHaveBeenCalled();
            consoleError.mockRestore();
        });
    });
});
