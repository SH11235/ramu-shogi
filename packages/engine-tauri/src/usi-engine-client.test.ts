import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUsiEngineClient } from "./usi-engine-client";

const { invokeMock, listenMock } = vi.hoisted(() => ({
    invokeMock: vi.fn(),
    listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

describe("createUsiEngineClient", () => {
    let unlistenMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        unlistenMock = vi.fn();
        listenMock.mockResolvedValue(unlistenMock);
        let session = 0;
        invokeMock.mockImplementation(async (command: string) => {
            if (command === "usi_engine_start") {
                session += 1;
                return `session-${session}`;
            }
            return undefined;
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("初回 init では quit を呼ばない", async () => {
        const client = createUsiEngineClient({ registrationId: "reg-1" });
        await client.init();

        expect(invokeMock).toHaveBeenCalledWith("usi_engine_start", {
            registration_id: "reg-1",
        });
        expect(invokeMock).not.toHaveBeenCalledWith("usi_engine_quit", expect.anything());
    });

    it("再 init は旧セッションを quit してから新セッションを張る", async () => {
        const client = createUsiEngineClient({ registrationId: "reg-1" });
        await client.init();
        await client.init();

        expect(invokeMock).toHaveBeenCalledWith("usi_engine_quit", {
            session_id: "session-1",
        });
        expect(unlistenMock).toHaveBeenCalledTimes(1);

        // quit → 2 回目の start の順で実行される
        const quitOrder = invokeMock.mock.invocationCallOrder[
            invokeMock.mock.calls.findIndex(([cmd]) => cmd === "usi_engine_quit")
        ] as number;
        const secondStartIndex = invokeMock.mock.calls.findIndex(
            ([cmd], index) => cmd === "usi_engine_start" && index > 0,
        );
        expect(quitOrder).toBeLessThan(
            invokeMock.mock.invocationCallOrder[secondStartIndex] as number,
        );

        // 新セッションで動作する
        await client.stop();
        expect(invokeMock).toHaveBeenCalledWith("usi_engine_stop", {
            session_id: "session-2",
        });
    });

    it("再 init で旧セッションの quit が失敗したら新 start を中止し、後で回収できる", async () => {
        const client = createUsiEngineClient({ registrationId: "reg-1" });
        await client.init();

        invokeMock.mockImplementationOnce(async (command: string) => {
            if (command === "usi_engine_quit") throw new Error("ipc down");
            return undefined;
        });
        await expect(client.init()).rejects.toThrow("ipc down");
        // 新セッションを張っていない (start は初回の 1 回のみ)
        expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "usi_engine_start")).toHaveLength(1);

        // 失敗した quit は 1 回記録済み。dispose が改めて quit することを回数で検証する
        expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "usi_engine_quit")).toHaveLength(1);
        await client.dispose();
        const quitCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "usi_engine_quit");
        expect(quitCalls).toHaveLength(2);
        expect(quitCalls[1]?.[1]).toEqual({ session_id: "session-1" });
    });

    it("並行 init は直列化され、片方のセッションがリークしない", async () => {
        const client = createUsiEngineClient({ registrationId: "reg-1" });
        await Promise.all([client.init(), client.init()]);

        // 2 回 start され、先行分 (session-1) は quit 済み
        expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "usi_engine_start")).toHaveLength(2);
        expect(invokeMock).toHaveBeenCalledWith("usi_engine_quit", {
            session_id: "session-1",
        });

        // quit は 2 回目の start より先に実行される (直列化の検証)
        const quitIndex = invokeMock.mock.calls.findIndex(([cmd]) => cmd === "usi_engine_quit");
        const secondStartIndex = invokeMock.mock.calls.findIndex(
            ([cmd], index) => cmd === "usi_engine_start" && index > 0,
        );
        expect(invokeMock.mock.invocationCallOrder[quitIndex] as number).toBeLessThan(
            invokeMock.mock.invocationCallOrder[secondStartIndex] as number,
        );

        await client.stop();
        expect(invokeMock).toHaveBeenCalledWith("usi_engine_stop", {
            session_id: "session-2",
        });
    });

    it("購読登録に失敗したら起動済みセッションを quit してから失敗する", async () => {
        listenMock.mockRejectedValueOnce(new Error("listen failed"));
        const client = createUsiEngineClient({ registrationId: "reg-1" });

        await expect(client.init()).rejects.toThrow("listen failed");
        expect(invokeMock).toHaveBeenCalledWith("usi_engine_quit", {
            session_id: "session-1",
        });
    });

    it("購読失敗後の quit も失敗したら識別子を保持し dispose で回収できる", async () => {
        listenMock.mockRejectedValueOnce(new Error("listen failed"));
        const client = createUsiEngineClient({ registrationId: "reg-1" });
        // listen 失敗に加えて quit も失敗させる (init 実行前なので beforeEach の実装を上書きしてよい)
        invokeMock.mockImplementation(async (command: string) => {
            if (command === "usi_engine_start") return "session-1";
            if (command === "usi_engine_quit") throw new Error("ipc down");
            return undefined;
        });

        await expect(client.init()).rejects.toThrow("listen failed");

        // quit の失敗を解消した後、dispose で回収できる
        invokeMock.mockImplementation(async () => undefined);
        await client.dispose();
        const quitCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "usi_engine_quit");
        expect(quitCalls[quitCalls.length - 1]?.[1]).toEqual({ session_id: "session-1" });
        expect(quitCalls).toHaveLength(2);
    });

    it("dispose はセッションを quit し購読を解除する", async () => {
        const client = createUsiEngineClient({ registrationId: "reg-1" });
        await client.init();
        await client.dispose();

        expect(invokeMock).toHaveBeenCalledWith("usi_engine_quit", {
            session_id: "session-1",
        });
        expect(unlistenMock).toHaveBeenCalledTimes(1);
    });

    it("探索時間を USI go 用パラメーターに変換する", async () => {
        const client = createUsiEngineClient({ registrationId: "reg-1" });
        await client.init();
        await client.search({
            limits: { btimeMs: 12_000, wtimeMs: 6_500, byoyomiMs: 1_000 },
        });

        expect(invokeMock).toHaveBeenCalledWith("usi_engine_go", {
            session_id: "session-1",
            params: {
                maxDepth: undefined,
                nodes: undefined,
                btimeMs: 12_000,
                wtimeMs: 6_500,
                byoyomiMs: 1_000,
                movetimeMs: undefined,
                infinite: false,
            },
        });
    });
});
