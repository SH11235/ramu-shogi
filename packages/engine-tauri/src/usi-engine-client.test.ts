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

    it("dispose はセッションを quit し購読を解除する", async () => {
        const client = createUsiEngineClient({ registrationId: "reg-1" });
        await client.init();
        await client.dispose();

        expect(invokeMock).toHaveBeenCalledWith("usi_engine_quit", {
            session_id: "session-1",
        });
        expect(unlistenMock).toHaveBeenCalledTimes(1);
    });
});
