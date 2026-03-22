import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
    invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { createPreviewSessionService } from "./preview-session-service";

describe("createPreviewSessionService", () => {
    beforeEach(() => {
        mockInvoke.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("start", () => {
        it("セッションを起動して ready に遷移する", async () => {
            mockInvoke.mockResolvedValueOnce("session-1");
            const svc = createPreviewSessionService();

            const sid = await svc.start("reg-1");

            expect(sid).toBe("session-1");
            expect(svc.getStatus()).toEqual({
                state: "ready",
                registrationId: "reg-1",
                sessionId: "session-1",
            });
            expect(mockInvoke).toHaveBeenCalledWith("usi_engine_start", {
                registration_id: "reg-1",
            });
        });

        it("起動失敗で error に遷移する", async () => {
            mockInvoke.mockRejectedValueOnce(new Error("Engine not found"));
            const svc = createPreviewSessionService();

            await expect(svc.start("reg-1")).rejects.toThrow("Engine not found");
            expect(svc.getStatus()).toEqual({
                state: "error",
                registrationId: "reg-1",
                error: "Engine not found",
            });
        });

        it("再起動時に既存セッションを quit する", async () => {
            mockInvoke
                .mockResolvedValueOnce("session-1") // first start
                .mockResolvedValueOnce(undefined) // quit
                .mockResolvedValueOnce("session-2"); // second start
            const svc = createPreviewSessionService();

            await svc.start("reg-1");
            await svc.start("reg-2");

            expect(mockInvoke).toHaveBeenCalledWith("usi_engine_quit", {
                session_id: "session-1",
            });
            expect(svc.getStatus()).toEqual({
                state: "ready",
                registrationId: "reg-2",
                sessionId: "session-2",
            });
        });
    });

    describe("孤児セッション防止", () => {
        it("起動中に再 start すると古い結果を孤児として quit する", async () => {
            let resolveFirst: (v: string) => void;
            const firstStart = new Promise<string>((r) => {
                resolveFirst = r;
            });

            mockInvoke
                .mockReturnValueOnce(firstStart) // first start (pending)
                .mockResolvedValueOnce("session-2") // second start
                .mockResolvedValueOnce(undefined); // quit orphan

            const svc = createPreviewSessionService();
            const p1 = svc.start("reg-1");

            // 起動中に別エンジンを選択
            const sid2 = await svc.start("reg-2");
            expect(sid2).toBe("session-2");

            // 最初の起動が完了 → 孤児としてquitされるはず
            resolveFirst!("session-orphan");
            await expect(p1).rejects.toThrow("Start request superseded");

            expect(mockInvoke).toHaveBeenCalledWith("usi_engine_quit", {
                session_id: "session-orphan",
            });
        });

        it("起動中に dispose すると完了後の結果を孤児として quit する", async () => {
            let resolveStart: (v: string) => void;
            const startPromise = new Promise<string>((r) => {
                resolveStart = r;
            });

            mockInvoke
                .mockReturnValueOnce(startPromise) // start (pending)
                .mockResolvedValue(undefined); // quit orphan (and any other calls)

            const svc = createPreviewSessionService();
            const p = svc.start("reg-1");

            // start()はquitCurrent() awaitを終えてからusi_engine_startを呼ぶので、
            // 一度マイクロタスクを進めてstart内部のawaitを通過させる
            await Promise.resolve();

            // パネルを閉じる
            await svc.dispose();
            expect(svc.getStatus()).toEqual({ state: "idle" });

            // 起動が完了 → 孤児としてquitされるはず
            resolveStart!("session-orphan");
            await expect(p).rejects.toThrow("Start request superseded");

            expect(mockInvoke).toHaveBeenCalledWith("usi_engine_quit", {
                session_id: "session-orphan",
            });
        });
    });

    describe("setOption / sendButton", () => {
        it("ready 状態で setoption を送信できる", async () => {
            mockInvoke
                .mockResolvedValueOnce("session-1") // start
                .mockResolvedValueOnce(undefined); // setoption
            const svc = createPreviewSessionService();
            await svc.start("reg-1");

            await svc.setOption("Threads", 4);

            expect(mockInvoke).toHaveBeenCalledWith("usi_engine_setoption", {
                session_id: "session-1",
                name: "Threads",
                value: "4",
            });
        });

        it("ready 状態で button を送信できる", async () => {
            mockInvoke
                .mockResolvedValueOnce("session-1") // start
                .mockResolvedValueOnce(undefined); // send_button
            const svc = createPreviewSessionService();
            await svc.start("reg-1");

            await svc.sendButton("Clear Hash");

            expect(mockInvoke).toHaveBeenCalledWith("usi_engine_send_button", {
                session_id: "session-1",
                name: "Clear Hash",
            });
        });

        it("idle 状態で setOption を呼ぶとエラー", async () => {
            const svc = createPreviewSessionService();
            await expect(svc.setOption("Threads", 4)).rejects.toThrow("not ready");
        });

        it("setOption 失敗で error に遷移する", async () => {
            mockInvoke
                .mockResolvedValueOnce("session-1") // start
                .mockRejectedValueOnce(new Error("Session disconnected")); // setoption fail
            const svc = createPreviewSessionService();
            await svc.start("reg-1");

            await expect(svc.setOption("Threads", 4)).rejects.toThrow("Session disconnected");
            expect(svc.getStatus()).toEqual({
                state: "error",
                registrationId: "reg-1",
                sessionId: "session-1",
                error: "Session disconnected",
            });
        });

        it("sendButton 失敗で error に遷移する", async () => {
            mockInvoke
                .mockResolvedValueOnce("session-1") // start
                .mockRejectedValueOnce(new Error("Session disconnected")); // send_button fail
            const svc = createPreviewSessionService();
            await svc.start("reg-1");

            await expect(svc.sendButton("Clear Hash")).rejects.toThrow("Session disconnected");
            expect(svc.getStatus()).toEqual({
                state: "error",
                registrationId: "reg-1",
                sessionId: "session-1",
                error: "Session disconnected",
            });
        });
    });

    describe("dispose", () => {
        it("ready セッションを quit して idle に戻る", async () => {
            mockInvoke
                .mockResolvedValueOnce("session-1") // start
                .mockResolvedValueOnce(undefined); // quit
            const svc = createPreviewSessionService();
            await svc.start("reg-1");

            await svc.dispose();

            expect(svc.getStatus()).toEqual({ state: "idle" });
            expect(mockInvoke).toHaveBeenCalledWith("usi_engine_quit", {
                session_id: "session-1",
            });
        });

        it("idle 状態で dispose しても安全", async () => {
            const svc = createPreviewSessionService();
            await svc.dispose();
            expect(svc.getStatus()).toEqual({ state: "idle" });
        });

        it("error 状態で dispose すると sessionId を quit する", async () => {
            mockInvoke
                .mockResolvedValueOnce("session-1") // start
                .mockRejectedValueOnce(new Error("disconnect")) // setoption fail
                .mockResolvedValueOnce(undefined); // quit
            const svc = createPreviewSessionService();
            await svc.start("reg-1");
            await svc.setOption("Threads", 4).catch(() => undefined);
            expect(svc.getStatus().state).toBe("error");

            await svc.dispose();

            expect(svc.getStatus()).toEqual({ state: "idle" });
            expect(mockInvoke).toHaveBeenCalledWith("usi_engine_quit", {
                session_id: "session-1",
            });
        });
    });

    describe("sendButton idle エラー", () => {
        it("idle 状態で sendButton を呼ぶとエラー", async () => {
            const svc = createPreviewSessionService();
            await expect(svc.sendButton("Clear Hash")).rejects.toThrow("not ready");
        });
    });
});
