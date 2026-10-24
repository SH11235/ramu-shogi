import type { EngineEvent } from "@shogi/engine-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TauriIpc } from "./index";
import { createTauriEngineClient, getLegalMoves } from "./index";

describe("createTauriEngineClient", () => {
    let mockInvoke: ReturnType<typeof vi.fn>;
    let mockListen: ReturnType<typeof vi.fn>;
    let mockUnlisten: ReturnType<typeof vi.fn>;
    let mockIpc: TauriIpc;

    beforeEach(() => {
        mockInvoke = vi.fn();
        mockListen = vi.fn();
        mockUnlisten = vi.fn();
        mockIpc = {
            invoke: mockInvoke as TauriIpc["invoke"],
            listen: mockListen as TauriIpc["listen"],
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("基本操作", () => {
        it("wraps model loading arguments for the native command", async () => {
            mockInvoke.mockResolvedValue(undefined);
            const client = createTauriEngineClient({ ipc: mockIpc });
            const layerStacks = { bucketMode: "kingrank9" as const };
            await client.loadNnue?.("model-id", layerStacks);
            expect(mockInvoke).toHaveBeenCalledWith("engine_load_nnue", {
                args: { nnueId: "model-id", layerStacks },
            });
        });
        it("init で IPC を呼び出す", async () => {
            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockResolvedValue(mockUnlisten);

            const client = createTauriEngineClient({
                ipc: mockIpc,
            });

            await client.init();

            expect(mockInvoke).toHaveBeenCalledWith("engine_init", { opts: undefined });
            expect(mockListen).toHaveBeenCalledWith("engine://event", expect.any(Function));
        });

        it("init オプションを正しく渡す", async () => {
            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockResolvedValue(mockUnlisten);

            const client = createTauriEngineClient({
                ipc: mockIpc,
                threads: 4,
                ttSizeMb: 1024,
            });

            await client.init({ multiPv: 3 });

            expect(mockInvoke).toHaveBeenCalledWith("engine_init", {
                opts: { multiPv: 3 },
            });
        });

        it("loadPosition で IPC を呼び出す", async () => {
            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockResolvedValue(mockUnlisten);

            const client = createTauriEngineClient({
                ipc: mockIpc,
            });

            await client.loadPosition("startpos", ["7g7f"]);

            expect(mockInvoke).toHaveBeenCalledWith("engine_position", {
                sfen: "startpos",
                moves: ["7g7f"],
            });
        });

        it("search で IPC を呼び出す", async () => {
            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockResolvedValue(mockUnlisten);

            const client = createTauriEngineClient({
                ipc: mockIpc,
            });

            await client.init();
            const handle = await client.search({ limits: { maxDepth: 10 } });

            expect(mockInvoke).toHaveBeenCalledWith("engine_search", {
                params: { limits: { maxDepth: 10 } },
            });
            expect(handle.cancel).toBeInstanceOf(Function);
        });

        it("stop で IPC を呼び出す", async () => {
            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockResolvedValue(mockUnlisten);

            const client = createTauriEngineClient({
                ipc: mockIpc,
            });

            await client.stop();

            expect(mockInvoke).toHaveBeenCalledWith("engine_stop");
        });

        it("setOption で IPC を呼び出す", async () => {
            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockResolvedValue(mockUnlisten);

            const client = createTauriEngineClient({
                ipc: mockIpc,
            });

            await client.setOption("threads", 4);

            expect(mockInvoke).toHaveBeenCalledWith("engine_option", {
                name: "threads",
                value: 4,
            });
        });
    });

    describe("イベント購読", () => {
        it("subscribe でイベントリスナーを登録する", () => {
            const client = createTauriEngineClient({
                ipc: mockIpc,
            });

            const handler = vi.fn();
            const unsubscribe = client.subscribe(handler);

            expect(unsubscribe).toBeInstanceOf(Function);
        });

        it("イベントが発行されたらハンドラを呼び出す", async () => {
            let eventCallback: ((evt: { payload: EngineEvent }) => void) | null = null;

            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockImplementation(
                (_eventName: string, callback: (evt: { payload: EngineEvent }) => void) => {
                    eventCallback = callback;
                    return Promise.resolve(mockUnlisten);
                },
            );

            const client = createTauriEngineClient({
                ipc: mockIpc,
            });

            const handler = vi.fn();
            client.subscribe(handler);

            await client.init();

            // イベントを発行
            const event: EngineEvent = {
                type: "bestmove",
                move: "7g7f",
            };
            if (eventCallback) {
                (eventCallback as (evt: { payload: EngineEvent }) => void)({ payload: event });
            }

            expect(handler).toHaveBeenCalledWith(event);
        });

        it("届いたイベントの null の項目を落としてからハンドラに渡す", async () => {
            let eventCallback: ((evt: { payload: unknown }) => void) | null = null;
            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockImplementation(
                (_eventName: string, callback: (evt: { payload: unknown }) => void) => {
                    eventCallback = callback;
                    return Promise.resolve(mockUnlisten);
                },
            );
            const client = createTauriEngineClient({ ipc: mockIpc });
            const handler = vi.fn();
            client.subscribe(handler);
            await client.init();

            (eventCallback as unknown as (evt: { payload: unknown }) => void)({
                payload: { type: "info", depth: 0, nodes: 0, scoreCp: null, scoreMate: null },
            });

            expect(handler).toHaveBeenCalledWith({ type: "info", depth: 0, nodes: 0 });
        });

        it("unsubscribe でハンドラを削除する", async () => {
            let eventCallback: ((evt: { payload: EngineEvent }) => void) | null = null;

            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockImplementation(
                (_eventName: string, callback: (evt: { payload: EngineEvent }) => void) => {
                    eventCallback = callback;
                    return Promise.resolve(mockUnlisten);
                },
            );

            const client = createTauriEngineClient({
                ipc: mockIpc,
            });

            const handler = vi.fn();
            const unsubscribe = client.subscribe(handler);

            await client.init();

            // unsubscribe を呼び出す
            unsubscribe();

            // イベントを発行
            const event: EngineEvent = {
                type: "bestmove",
                move: "7g7f",
            };
            if (eventCallback) {
                (eventCallback as (evt: { payload: EngineEvent }) => void)({ payload: event });
            }

            // ハンドラは呼ばれない
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe("エラーハンドリング", () => {
        it("useMockOnError: true の場合、IPC エラー時にモックにフォールバックする", async () => {
            mockInvoke.mockRejectedValue(new Error("IPC failed"));

            const client = createTauriEngineClient({
                ipc: mockIpc,
                useMockOnError: true,
            });

            // エラーは投げられず、モックが動作する
            await expect(client.init()).resolves.toBeUndefined();
            await expect(client.loadPosition("startpos")).resolves.toBeUndefined();
        });

        it("useMockOnError: false の場合、IPC エラーを投げる", async () => {
            mockInvoke.mockRejectedValue(new Error("IPC failed"));

            const client = createTauriEngineClient({
                ipc: mockIpc,
                useMockOnError: false,
            });

            // エラーが投げられる
            await expect(client.init()).rejects.toThrow("IPC failed");
        });

        it("listen エラー時にモックにフォールバックする (useMockOnError: true)", async () => {
            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockRejectedValue(new Error("Listen failed"));

            const client = createTauriEngineClient({
                ipc: mockIpc,
                useMockOnError: true,
            });

            const handler = vi.fn();
            client.subscribe(handler);

            // init で listen が失敗するが、モックにフォールバック
            await expect(client.init()).resolves.toBeUndefined();
        });
    });

    describe("getThreadInfo", () => {
        it("engine_thread_info で取れた実際のスレッド数を返す", async () => {
            mockInvoke.mockImplementation(async (command: string) =>
                command === "engine_thread_info"
                    ? {
                          activeThreads: 4,
                          maxThreads: 8,
                          threadedAvailable: true,
                          hardwareConcurrency: 8,
                      }
                    : undefined,
            );
            mockListen.mockResolvedValue(mockUnlisten);
            const client = createTauriEngineClient({ ipc: mockIpc });
            await client.init();
            expect(client.getThreadInfo?.().activeThreads).toBe(4);
        });

        it("初期化前・取得に失敗したときは activeThreads を 0（不明）にする", async () => {
            mockInvoke.mockImplementation(async (command: string) => {
                if (command === "engine_thread_info") throw new Error("not available");
            });
            mockListen.mockResolvedValue(mockUnlisten);
            const client = createTauriEngineClient({ ipc: mockIpc });
            expect(client.getThreadInfo?.().activeThreads).toBe(0);
            await client.init();
            expect(client.getThreadInfo?.().activeThreads).toBe(0);
        });
    });

    describe("dispose", () => {
        it("dispose でリソースをクリーンアップする", async () => {
            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockResolvedValue(mockUnlisten);

            const client = createTauriEngineClient({
                ipc: mockIpc,
            });

            await client.init();
            await client.dispose();

            expect(mockInvoke).toHaveBeenCalledWith("engine_stop");
            expect(mockUnlisten).toHaveBeenCalled();
        });
    });

    describe("カスタムイベント名", () => {
        it("eventName オプションで独自のイベント名を使用できる", async () => {
            mockInvoke.mockResolvedValue(undefined);
            mockListen.mockResolvedValue(mockUnlisten);

            const client = createTauriEngineClient({
                ipc: mockIpc,
                eventName: "custom://event",
            });

            await client.init();

            expect(mockListen).toHaveBeenCalledWith("custom://event", expect.any(Function));
        });
    });
});

describe("getLegalMoves", () => {
    let mockInvoke: ReturnType<typeof vi.fn>;
    let mockIpc: Partial<TauriIpc>;

    beforeEach(() => {
        mockInvoke = vi.fn();
        mockIpc = {
            invoke: mockInvoke as TauriIpc["invoke"],
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("IPC 経由で合法手を取得する", async () => {
        mockInvoke.mockResolvedValue(["7g7f", "2g2f", "6g6f"]);

        const result = await getLegalMoves({
            sfen: "startpos",
            ipc: mockIpc,
        });

        expect(mockInvoke).toHaveBeenCalledWith("engine_legal_moves", {
            sfen: "startpos",
            moves: undefined,
        });
        expect(result).toEqual(["7g7f", "2g2f", "6g6f"]);
    });

    it("moves パラメータを正しく渡す", async () => {
        mockInvoke.mockResolvedValue(["3c3d", "8c8d"]);

        const result = await getLegalMoves({
            sfen: "startpos",
            moves: ["7g7f"],
            ipc: mockIpc,
        });

        expect(mockInvoke).toHaveBeenCalledWith("engine_legal_moves", {
            sfen: "startpos",
            moves: ["7g7f"],
        });
        expect(result).toEqual(["3c3d", "8c8d"]);
    });

    it("パス権は、Tauri のコマンドの引数名（camelCase の passRights）で渡す", async () => {
        // Rust 側の引数は `pass_rights` だが、Tauri は JS 側の camelCase の名前から対応づける。
        // snake_case で渡すと無視され、パス権が無いものとして扱われる。
        mockInvoke.mockResolvedValue(["pass"]);
        await getLegalMoves({
            sfen: "startpos",
            moves: ["7g7f"],
            passRights: { sente: 1, gote: 2 },
            ipc: mockIpc,
        });
        expect(mockInvoke).toHaveBeenCalledWith("engine_legal_moves", {
            sfen: "startpos",
            moves: ["7g7f"],
            passRights: { sente: 1, gote: 2 },
        });

        mockInvoke.mockResolvedValue(undefined);
        const client = createTauriEngineClient({ ipc: mockIpc });
        await client.loadPosition("startpos", ["7g7f", "pass"], {
            passRights: { sente: 1, gote: 2 },
        });
        expect(mockInvoke).toHaveBeenCalledWith("engine_position", {
            sfen: "startpos",
            moves: ["7g7f", "pass"],
            passRights: { sente: 1, gote: 2 },
        });
    });

    it("エラー時は空配列を返す", async () => {
        mockInvoke.mockRejectedValue(new Error("Failed to get legal moves"));

        const result = await getLegalMoves({
            sfen: "startpos",
            ipc: mockIpc,
        });

        expect(result).toEqual([]);
    });
});
