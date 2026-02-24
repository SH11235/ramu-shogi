// RoomDO の統合テスト
//
// 実行方法: 別ターミナルで `wrangler dev` を起動してから実行
//   INTEGRATION=true pnpm --filter web test:integration
//
// テストしていないとき（INTEGRATION=true でない）はスキップされる

import { beforeAll, describe, expect, it } from "vitest";

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

// メッセージキューを持つ WebSocket クライアント
// リスナー設置前に届いたメッセージも見逃さない
interface WsClient {
    ws: WebSocket;
    messages: Record<string, unknown>[];
    waitForOpen: () => Promise<void>;
    waitFor: (
        predicate: (msg: Record<string, unknown>) => boolean,
        timeoutMs?: number,
    ) => Promise<Record<string, unknown>>;
    send: (t: string, payload: Record<string, unknown>) => void;
    close: () => void;
}

function createWsClient(roomId: string): WsClient {
    const wsUrl = BASE_URL.replace(/^http/, "ws");
    const ws = new WebSocket(`${wsUrl}/api/rooms/${roomId}/ws`);
    const messages: Record<string, unknown>[] = [];

    // 接続開始直後からメッセージをキューに溜める
    ws.addEventListener("message", (event: MessageEvent) => {
        try {
            const msg = JSON.parse(event.data as string) as Record<string, unknown>;
            messages.push(msg);
        } catch {
            // ignore parse errors
        }
    });

    const waitForOpen = (): Promise<void> =>
        new Promise((resolve, reject) => {
            if ((ws.readyState as number) === 1) {
                resolve();
                return;
            }
            ws.addEventListener("open", () => resolve(), { once: true });
            ws.addEventListener("error", () => reject(new Error("WebSocket error")), {
                once: true,
            });
        });

    // キューをポーリングして条件に合うメッセージを待つ
    const waitFor = (
        predicate: (msg: Record<string, unknown>) => boolean,
        timeoutMs = 5000,
    ): Promise<Record<string, unknown>> => {
        const start = Date.now();
        return new Promise((resolve, reject) => {
            const poll = (): void => {
                const found = messages.find(predicate);
                if (found) {
                    resolve(found);
                    return;
                }
                if (Date.now() - start >= timeoutMs) {
                    reject(
                        new Error(
                            `Timeout after ${timeoutMs}ms. Received: ${JSON.stringify(messages)}`,
                        ),
                    );
                    return;
                }
                setTimeout(poll, 30);
            };
            poll();
        });
    };

    const send = (t: string, payload: Record<string, unknown>): void => {
        ws.send(JSON.stringify({ v: 1, t, clientMsgId: 1, payload }));
    };

    const close = (): void => ws.close();

    return { ws, messages, waitForOpen, waitFor, send, close };
}

// ─── テスト ───────────────────────────────────────────────────────────────────

describe("RoomDO 統合テスト（wrangler dev が必要）", () => {
    beforeAll(() => {
        if (!IS_INTEGRATION) {
            console.log("統合テストをスキップ: INTEGRATION=true を設定して実行してください");
        }
    });

    // ── 正常対局フロー ─────────────────────────────────────────────────────────
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
            const clientB = createWsClient(roomId);
            const clientW = createWsClient(roomId);

            await Promise.all([clientB.waitForOpen(), clientW.waitForOpen()]);

            // 先手参加
            clientB.send("join", { seat: "b", name: "先手テスト" });
            const joinedB = await clientB.waitFor((m) => m.t === "joined");
            expect((joinedB as { payload?: { seat?: string } }).payload?.seat).toBe("b");

            // 後手参加（game_start は wsB にも同時に届く → キューに積まれる）
            clientW.send("join", { seat: "w", name: "後手テスト" });
            const joinedW = await clientW.waitFor((m) => m.t === "joined");
            expect((joinedW as { payload?: { seat?: string } }).payload?.seat).toBe("w");

            // game_start を両者が受け取る（キューに既に積まれていても検出できる）
            const [gameStartB] = await Promise.all([
                clientB.waitFor(
                    (m) =>
                        m.t === "event" &&
                        (m.payload as Record<string, unknown>)?.kind === "game_start",
                ),
                clientW.waitFor(
                    (m) =>
                        m.t === "event" &&
                        (m.payload as Record<string, unknown>)?.kind === "game_start",
                ),
            ]);
            expect(gameStartB.t).toBe("event");

            clientB.close();
            clientW.close();
        });
    });

    // ── 異常系（セキュリティ） ────────────────────────────────────────────────
    describe("異常系", () => {
        itIntegration("満席のルームに参加しようとすると ROOM_FULL エラーになる", async () => {
            const roomId = await createRoom();
            const clientB = createWsClient(roomId);
            const clientW = createWsClient(roomId);
            const clientExtra = createWsClient(roomId);

            await Promise.all([
                clientB.waitForOpen(),
                clientW.waitForOpen(),
                clientExtra.waitForOpen(),
            ]);

            clientB.send("join", { seat: "b", name: "先手" });
            await clientB.waitFor((m) => m.t === "joined");

            clientW.send("join", { seat: "w", name: "後手" });
            await clientW.waitFor((m) => m.t === "joined");

            clientExtra.send("join", { seat: "b", name: "侵入者" });
            const errMsg = await clientExtra.waitFor((m) => m.t === "error");
            expect((errMsg as { payload?: { code?: string } }).payload?.code).toBe("ROOM_FULL");

            clientB.close();
            clientW.close();
            clientExtra.close();
        });

        itIntegration("自分の手番でないとき move を送ると NOT_YOUR_TURN エラーになる", async () => {
            const roomId = await createRoom();
            const clientB = createWsClient(roomId);
            const clientW = createWsClient(roomId);

            await Promise.all([clientB.waitForOpen(), clientW.waitForOpen()]);

            clientB.send("join", { seat: "b", name: "先手" });
            await clientB.waitFor((m) => m.t === "joined");

            clientW.send("join", { seat: "w", name: "後手" });
            await clientW.waitFor((m) => m.t === "joined");

            // game_start を待つ（キューに積まれていても検出）
            await Promise.all([
                clientB.waitFor(
                    (m) =>
                        m.t === "event" &&
                        (m.payload as Record<string, unknown>)?.kind === "game_start",
                ),
                clientW.waitFor(
                    (m) =>
                        m.t === "event" &&
                        (m.payload as Record<string, unknown>)?.kind === "game_start",
                ),
            ]);

            // 後手（clientW）が先に指そうとする
            clientW.send("move", { eventId: 1, usi: "3c3d", sfen: "" });
            const errMsg = await clientW.waitFor((m) => m.t === "error");
            expect((errMsg as { payload?: { code?: string } }).payload?.code).toBe("NOT_YOUR_TURN");

            clientB.close();
            clientW.close();
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

    // ── AI サポート ────────────────────────────────────────────────────────────
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

                const clientB = createWsClient(roomId);
                const clientW = createWsClient(roomId);

                await Promise.all([clientB.waitForOpen(), clientW.waitForOpen()]);

                clientB.send("join", { seat: "b", name: "先手" });
                await clientB.waitFor((m) => m.t === "joined");

                clientW.send("join", { seat: "w", name: "後手" });
                await clientW.waitFor((m) => m.t === "joined");

                await Promise.all([
                    clientB.waitFor(
                        (m) =>
                            m.t === "event" &&
                            (m.payload as Record<string, unknown>)?.kind === "game_start",
                    ),
                    clientW.waitFor(
                        (m) =>
                            m.t === "event" &&
                            (m.payload as Record<string, unknown>)?.kind === "game_start",
                    ),
                ]);

                // 先手が use_analysis を送信（制限モード: 残り 3 → 2）
                clientB.send("use_analysis", { eventId: 1, ply: 0 });
                const analysisUsedMsg = await clientB.waitFor(
                    (m) =>
                        m.t === "event" &&
                        (m.payload as Record<string, unknown>)?.kind === "analysis_used",
                );
                const payload = (analysisUsedMsg as { payload?: { analysisRemaining?: number } })
                    .payload;
                expect(payload?.analysisRemaining).toBe(2);

                clientB.close();
                clientW.close();
            },
        );
    });
});
