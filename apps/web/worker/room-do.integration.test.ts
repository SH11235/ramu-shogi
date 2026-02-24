// apps/web/worker/room-do.integration.test.ts
// RoomDO の統合テスト（T-402）
//
// 実行方法: 別ターミナルで `wrangler dev` を起動してから実行
//   INTEGRATION=true pnpm --filter web test:integration
//
// テストしていないとき（INTEGRATION=true でない）はスキップされる

import { describe, it, expect, beforeAll } from "vitest";

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? "http://localhost:8787";
const IS_INTEGRATION = process.env.INTEGRATION === "true";

const itIntegration = IS_INTEGRATION ? it : it.skip;

// ─── ヘルパー ──────────────────────────────────────────────────────────────────

async function createRoom(settings?: Record<string, unknown>): Promise<string> {
    const defaultSettings = {
        startSfen: "startpos",
        timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
        passRights: null,
        aiSupport: null,
    };
    const res = await fetch(`${BASE_URL}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { ...defaultSettings, ...settings } }),
    });
    const data = (await res.json()) as { roomId: string };
    return data.roomId;
}

function connectWs(roomId: string): WebSocket {
    const wsUrl = BASE_URL.replace(/^http/, "ws");
    return new WebSocket(`${wsUrl}/api/rooms/${roomId}/ws`);
}

async function waitForMessage(
    ws: WebSocket,
    predicate: (msg: Record<string, unknown>) => boolean,
    timeoutMs = 3000,
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error("Timeout waiting for message"));
        }, timeoutMs);

        const handler = (event: MessageEvent): void => {
            const msg = JSON.parse(event.data as string) as Record<string, unknown>;
            if (predicate(msg)) {
                clearTimeout(timer);
                ws.removeEventListener("message", handler);
                resolve(msg);
            }
        };
        ws.addEventListener("message", handler);
    });
}

function sendMsg(ws: WebSocket, t: string, payload: Record<string, unknown>): void {
    ws.send(JSON.stringify({ v: 1, t, clientMsgId: 1, payload }));
}

// ─── テスト ───────────────────────────────────────────────────────────────────

describe("RoomDO 統合テスト（wrangler dev が必要）", () => {
    beforeAll(() => {
        if (!IS_INTEGRATION) {
            console.log("統合テストをスキップ: INTEGRATION=true を設定して実行してください");
        }
    });

    // ── T-402: 正常対局フロー ─────────────────────────────────────────────────
    describe("正常対局フロー", () => {
        itIntegration("ルームを作成できる", async () => {
            const res = await fetch(`${BASE_URL}/api/rooms`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    settings: {
                        startSfen: "startpos",
                        timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
                        passRights: null,
                        aiSupport: null,
                    },
                }),
            });
            expect(res.status).toBe(200);
            const data = (await res.json()) as { roomId: string; shareUrl: string };
            expect(data.roomId).toHaveLength(6);
            expect(data.shareUrl).toContain(data.roomId);
        });

        itIntegration("GET /api/rooms/:roomId でルーム情報を取得できる", async () => {
            const roomId = await createRoom();
            const res = await fetch(`${BASE_URL}/api/rooms/${roomId}`);
            expect(res.status).toBe(200);
            const data = (await res.json()) as { roomId: string; status: string };
            expect(data.roomId).toBe(roomId);
            expect(data.status).toBe("waiting");
        });

        itIntegration("存在しないルームは 404 を返す", async () => {
            const res = await fetch(`${BASE_URL}/api/rooms/notexist`);
            expect(res.status).toBe(404);
        });

        itIntegration("先手・後手が参加して game_start を受け取る", async () => {
            const roomId = await createRoom();
            const wsB = connectWs(roomId);
            const wsW = connectWs(roomId);

            await Promise.all([
                new Promise<void>((resolve) => wsB.addEventListener("open", () => resolve())),
                new Promise<void>((resolve) => wsW.addEventListener("open", () => resolve())),
            ]);

            sendMsg(wsB, "join", { seat: "b", name: "先手テスト" });
            const joinedB = await waitForMessage(wsB, (m) => m.t === "joined");
            expect((joinedB as { payload?: { seat?: string } }).payload?.seat).toBe("b");

            sendMsg(wsW, "join", { seat: "w", name: "後手テスト" });
            const joinedW = await waitForMessage(wsW, (m) => m.t === "joined");
            expect((joinedW as { payload?: { seat?: string } }).payload?.seat).toBe("w");

            // game_start を両者が受け取る
            const [gameStartB] = await Promise.all([
                waitForMessage(
                    wsB,
                    (m) =>
                        m.t === "event" &&
                        (m.payload as Record<string, unknown>)?.kind === "game_start",
                ),
                waitForMessage(
                    wsW,
                    (m) =>
                        m.t === "event" &&
                        (m.payload as Record<string, unknown>)?.kind === "game_start",
                ),
            ]);
            expect(gameStartB.t).toBe("event");

            wsB.close();
            wsW.close();
        });
    });

    // ── T-402: 異常系（セキュリティ） ────────────────────────────────────────
    describe("異常系", () => {
        itIntegration("満席のルームに参加しようとすると ROOM_FULL エラーになる", async () => {
            const roomId = await createRoom();
            const wsB = connectWs(roomId);
            const wsW = connectWs(roomId);
            const wsExtra = connectWs(roomId);

            await Promise.all([
                new Promise<void>((resolve) => wsB.addEventListener("open", () => resolve())),
                new Promise<void>((resolve) => wsW.addEventListener("open", () => resolve())),
                new Promise<void>((resolve) => wsExtra.addEventListener("open", () => resolve())),
            ]);

            sendMsg(wsB, "join", { seat: "b", name: "先手" });
            await waitForMessage(wsB, (m) => m.t === "joined");

            sendMsg(wsW, "join", { seat: "w", name: "後手" });
            await waitForMessage(wsW, (m) => m.t === "joined");

            sendMsg(wsExtra, "join", { seat: "b", name: "侵入者" });
            const errMsg = await waitForMessage(wsExtra, (m) => m.t === "error");
            expect((errMsg as { payload?: { code?: string } }).payload?.code).toBe("ROOM_FULL");

            wsB.close();
            wsW.close();
            wsExtra.close();
        });

        itIntegration("自分の手番でないとき move を送ると NOT_YOUR_TURN エラーになる", async () => {
            const roomId = await createRoom();
            const wsB = connectWs(roomId);
            const wsW = connectWs(roomId);

            await Promise.all([
                new Promise<void>((resolve) => wsB.addEventListener("open", () => resolve())),
                new Promise<void>((resolve) => wsW.addEventListener("open", () => resolve())),
            ]);

            sendMsg(wsB, "join", { seat: "b", name: "先手" });
            await waitForMessage(wsB, (m) => m.t === "joined");

            sendMsg(wsW, "join", { seat: "w", name: "後手" });
            await waitForMessage(wsW, (m) => m.t === "joined");

            // game_start を待つ
            await Promise.all([
                waitForMessage(
                    wsB,
                    (m) =>
                        m.t === "event" &&
                        (m.payload as Record<string, unknown>)?.kind === "game_start",
                ),
                waitForMessage(
                    wsW,
                    (m) =>
                        m.t === "event" &&
                        (m.payload as Record<string, unknown>)?.kind === "game_start",
                ),
            ]);

            // 後手（wsW）が先に指そうとする
            sendMsg(wsW, "move", { eventId: 1, usi: "3c3d", sfen: "" });
            const errMsg = await waitForMessage(wsW, (m) => m.t === "error");
            expect((errMsg as { payload?: { code?: string } }).payload?.code).toBe("NOT_YOUR_TURN");

            wsB.close();
            wsW.close();
        });

        itIntegration("無効な JSON body で POST /api/rooms は 400 を返す", async () => {
            const res = await fetch(`${BASE_URL}/api/rooms`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "invalid json",
            });
            expect(res.status).toBe(400);
        });

        itIntegration("不正な timeControl で POST /api/rooms は 400 を返す", async () => {
            const res = await fetch(`${BASE_URL}/api/rooms`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    settings: {
                        startSfen: "startpos",
                        timeControl: { type: "invalid", initialMs: -1 },
                        passRights: null,
                        aiSupport: null,
                    },
                }),
            });
            expect(res.status).toBe(400);
        });
    });

    // ── T-402: AI サポート ────────────────────────────────────────────────────
    describe("AI サポート", () => {
        itIntegration(
            "AI サポート設定付きのルームが作成でき、use_analysis が正しく処理される",
            async () => {
                const roomId = await createRoom({
                    aiSupport: {
                        b: { mode: "limited", limitCount: 3 },
                        w: { mode: "unlimited", limitCount: null },
                        searchDepth: 5,
                        searchTimeMs: 2000,
                    },
                });

                const wsB = connectWs(roomId);
                const wsW = connectWs(roomId);

                await Promise.all([
                    new Promise<void>((resolve) => wsB.addEventListener("open", () => resolve())),
                    new Promise<void>((resolve) => wsW.addEventListener("open", () => resolve())),
                ]);

                sendMsg(wsB, "join", { seat: "b", name: "先手" });
                await waitForMessage(wsB, (m) => m.t === "joined");

                sendMsg(wsW, "join", { seat: "w", name: "後手" });
                await waitForMessage(wsW, (m) => m.t === "joined");

                await Promise.all([
                    waitForMessage(
                        wsB,
                        (m) =>
                            m.t === "event" &&
                            (m.payload as Record<string, unknown>)?.kind === "game_start",
                    ),
                    waitForMessage(
                        wsW,
                        (m) =>
                            m.t === "event" &&
                            (m.payload as Record<string, unknown>)?.kind === "game_start",
                    ),
                ]);

                // 先手が use_analysis を送信（制限モード: 残り 3 → 2）
                sendMsg(wsB, "use_analysis", { eventId: 1, ply: 0 });
                const analysisUsedMsg = await waitForMessage(
                    wsB,
                    (m) =>
                        m.t === "event" &&
                        (m.payload as Record<string, unknown>)?.kind === "analysis_used",
                );
                const payload = (analysisUsedMsg as { payload?: { analysisRemaining?: number } })
                    .payload;
                expect(payload?.analysisRemaining).toBe(2);

                wsB.close();
                wsW.close();
            },
        );
    });
});
