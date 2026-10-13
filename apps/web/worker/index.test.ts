// @vitest-environment node

import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import worker from "./index";

type WorkerEnv = Parameters<typeof worker.fetch>[1];
type BackendCall = { url: string; init: RequestInit };
type ConsoleSpy = MockInstance<(...args: unknown[]) => void>;

const ORIGIN = "https://app.example.test";
const CREATE_BODY = JSON.stringify({ settings: { startSfen: "startpos" } });

function createEnv({
    rateLimitAllowed = true,
    backendResponse = () => Response.json({ from: "backend" }),
}: {
    rateLimitAllowed?: boolean;
    backendResponse?: () => Response;
} = {}) {
    const backendCalls: BackendCall[] = [];
    const rateLimitKeys: string[] = [];

    const env = {
        ASSETS: { fetch: async () => new Response("asset") },
        NNUE_BUCKET: {},
        BACKEND: {
            fetch: async (url: string, init: RequestInit) => {
                backendCalls.push({ url, init });
                return backendResponse();
            },
        },
        ROOM_RATE_LIMITER: {
            limit: async ({ key }: { key: string }) => {
                rateLimitKeys.push(key);
                return { success: rateLimitAllowed };
            },
        },
    } as unknown as WorkerEnv;

    return { env, backendCalls, rateLimitKeys };
}

function createRoomRequest(): Request {
    return new Request(`${ORIGIN}/api/rooms`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": "203.0.113.7",
            Cookie: "session=abc",
            Origin: ORIGIN,
        },
        body: CREATE_BODY,
    });
}

function webSocketUpgradeRequest(): Request {
    return new Request(`${ORIGIN}/api/rooms/room01/ws?probe=1`, {
        headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Protocol": "room.v1",
            "CF-Connecting-IP": "203.0.113.7",
            Cookie: "session=abc",
            Origin: ORIGIN,
        },
    });
}

function roomRequestLogs(spy: ConsoleSpy): Record<string, unknown>[] {
    return spy.mock.calls
        .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
        .filter((entry) => entry.event === "room_request");
}

describe("ルーム API の振り分け", () => {
    let logSpy: ConsoleSpy;
    let warnSpy: ConsoleSpy;

    beforeEach(() => {
        vi.restoreAllMocks();
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    describe("backend への転送", () => {
        it("ルーム作成をレート制限のあと backend へ転送し、応答をそのまま返す", async () => {
            const { env, backendCalls, rateLimitKeys } = createEnv({
                backendResponse: () =>
                    Response.json(
                        { error: "INVALID_REQUEST", message: "Invalid input" },
                        { status: 400 },
                    ),
            });

            const response = await worker.fetch(createRoomRequest(), env);

            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({
                error: "INVALID_REQUEST",
                message: "Invalid input",
            });
            expect(rateLimitKeys).toEqual(["203.0.113.7"]);
            expect(backendCalls).toHaveLength(1);

            const [{ url, init }] = backendCalls;
            const headers = new Headers(init.headers);
            expect(url).toBe(`${ORIGIN}/api/rooms`);
            expect(init.method).toBe("POST");
            expect(await new Response(init.body).text()).toBe(CREATE_BODY);
            expect(headers.get("Content-Type")).toBe("application/json");
            expect(headers.get("Cookie")).toBe("session=abc");
            expect(headers.get("Origin")).toBe(ORIGIN);
            expect(headers.get("CF-Connecting-IP")).toBe("203.0.113.7");
            expect(headers.get("X-Forwarded-Host")).toBe("app.example.test");
            expect(headers.get("X-Forwarded-Proto")).toBe("https");
            expect(roomRequestLogs(logSpy)).toEqual([
                {
                    event: "room_request",
                    served_by: "backend",
                    route: "create",
                    method: "POST",
                    status: 400,
                },
            ]);
        });

        it("レート制限を超えたルーム作成は backend を呼ばずに 429 を返す", async () => {
            const { env, backendCalls, rateLimitKeys } = createEnv({
                rateLimitAllowed: false,
            });

            const response = await worker.fetch(createRoomRequest(), env);

            expect(response.status).toBe(429);
            expect(response.headers.get("Content-Type")).toBe("application/json");
            expect(await response.json()).toEqual({
                error: "RATE_LIMITED",
                message: "Too many room creation requests. Please try again later.",
            });
            expect(rateLimitKeys).toEqual(["203.0.113.7"]);
            expect(backendCalls).toEqual([]);
            expect(roomRequestLogs(logSpy)).toMatchObject([
                { served_by: "rate_limiter", status: 429 },
            ]);
        });

        it("CF-Connecting-IP が無いルーム作成は共通のキーでレート制限する", async () => {
            const { env, rateLimitKeys } = createEnv();

            await worker.fetch(
                new Request(`${ORIGIN}/api/rooms`, { method: "POST", body: CREATE_BODY }),
                env,
            );

            expect(rateLimitKeys).toEqual(["unknown"]);
        });

        it("ルーム情報の取得を backend へ転送し、存在しないルームの 404 をそのまま返す", async () => {
            const { env, backendCalls, rateLimitKeys } = createEnv({
                backendResponse: () =>
                    Response.json(
                        { error: "ROOM_NOT_FOUND", message: "Room not found" },
                        { status: 404 },
                    ),
            });

            const response = await worker.fetch(
                new Request(`${ORIGIN}/api/rooms/room01`, { headers: { Cookie: "session=abc" } }),
                env,
            );

            expect(response.status).toBe(404);
            expect(await response.json()).toEqual({
                error: "ROOM_NOT_FOUND",
                message: "Room not found",
            });
            expect(rateLimitKeys).toEqual([]);
            expect(backendCalls).toHaveLength(1);
            expect(backendCalls[0].url).toBe(`${ORIGIN}/api/rooms/room01`);
            expect(backendCalls[0].init.method).toBe("GET");
            expect(backendCalls[0].init.body).toBeUndefined();
            expect(new Headers(backendCalls[0].init.headers).get("Cookie")).toBe("session=abc");
        });

        it("WebSocket 接続を backend へ転送し、101 応答を作り直さずに返す", async () => {
            // Node の Response は 101 を生成できないため、同一性だけを確かめる代役を使う
            const upgradeResponse = { status: 101, headers: new Headers() } as unknown as Response;
            const { env, backendCalls, rateLimitKeys } = createEnv({
                backendResponse: () => upgradeResponse,
            });

            const response = await worker.fetch(webSocketUpgradeRequest(), env);

            expect(response).toBe(upgradeResponse);
            expect(rateLimitKeys).toEqual([]);
            expect(backendCalls).toHaveLength(1);

            const [{ url, init }] = backendCalls;
            const headers = new Headers(init.headers);
            expect(url).toBe(`${ORIGIN}/api/rooms/room01/ws?probe=1`);
            expect(init.method).toBe("GET");
            expect(init.body).toBeUndefined();
            expect(headers.get("Upgrade")).toBe("websocket");
            expect(headers.get("Connection")).toBe("Upgrade");
            expect(headers.get("Sec-WebSocket-Key")).toBe("dGhlIHNhbXBsZSBub25jZQ==");
            expect(headers.get("Sec-WebSocket-Version")).toBe("13");
            expect(headers.get("Sec-WebSocket-Protocol")).toBe("room.v1");
            expect(headers.get("Cookie")).toBe("session=abc");
            expect(headers.get("Origin")).toBe(ORIGIN);
            expect(headers.get("CF-Connecting-IP")).toBe("203.0.113.7");
            expect(headers.get("X-Forwarded-Host")).toBe("app.example.test");
            expect(roomRequestLogs(logSpy)).toEqual([
                {
                    event: "room_request",
                    served_by: "backend",
                    route: "ws",
                    method: "GET",
                    status: 101,
                },
            ]);
        });

        it("WebSocket 接続を backend が拒否したときは、その応答をそのまま返す", async () => {
            const { env } = createEnv({
                backendResponse: () =>
                    Response.json(
                        {
                            error: "ROOM_BINDING_MISSING",
                            message: "ROOM binding is not configured",
                        },
                        { status: 500 },
                    ),
            });

            const response = await worker.fetch(webSocketUpgradeRequest(), env);

            expect(response.status).toBe(500);
            expect(await response.json()).toEqual({
                error: "ROOM_BINDING_MISSING",
                message: "ROOM binding is not configured",
            });
        });

        it("BACKEND binding が無いときは BACKEND_ORIGIN へ転送する", async () => {
            const { env } = createEnv();
            const fetchSpy = vi
                .spyOn(globalThis, "fetch")
                .mockResolvedValue(Response.json({ from: "origin" }));

            const response = await worker.fetch(new Request(`${ORIGIN}/api/rooms/room01?x=1`), {
                ...env,
                BACKEND: undefined,
                BACKEND_ORIGIN: "http://127.0.0.1:8788",
            });

            expect(await response.json()).toEqual({ from: "origin" });
            expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
                "http://127.0.0.1:8788/api/rooms/room01?x=1",
            ]);
        });

        it("転送先が無いときは 404 を返す", async () => {
            const { env } = createEnv();

            const response = await worker.fetch(new Request(`${ORIGIN}/api/rooms/room01`), {
                ...env,
                BACKEND: undefined,
            });

            expect(response.status).toBe(404);
            expect(roomRequestLogs(logSpy)).toMatchObject([{ served_by: "none", status: 404 }]);
        });

        it("ログにルーム ID・クエリ・Cookie を含めない", async () => {
            const { env } = createEnv();

            await worker.fetch(
                new Request(`${ORIGIN}/api/rooms/secretRoom?token=secretQuery`, {
                    headers: { Cookie: "session=secretCookie" },
                }),
                env,
            );

            const logged = logSpy.mock.calls.flat().join("\n");
            expect(logged).toContain("room_request");
            expect(logged).not.toMatch(/secretRoom|secretQuery|secretCookie/);
        });
    });

    describe("percent-encode されたパス", () => {
        // backend のルーターが /api/rooms として解釈するもの、しないものの両方を含む
        it.each([
            ["rooms の 1 文字目", "/api/%72ooms"],
            ["rooms の末尾", "/api/room%73"],
            ["16 進が小文字", "/api/%72%6f%6f%6d%73"],
            ["16 進が大文字", "/api/%72%6F%6F%6D%73"],
            ["二重エンコード", "/api/%2572ooms"],
            ["エンコードされたスラッシュ", "/api%2Frooms"],
            ["パス区切りのあとのエンコードされたスラッシュ", "/api/rooms%2F"],
            ["不正なエンコード", "/api/%ZZrooms"],
            ["途中で切れたエンコード", "/api/rooms%"],
        ])("POST %s (%s) はレート制限も転送もせず 400 を返す", async (_label, path) => {
            const { env, backendCalls, rateLimitKeys } = createEnv();

            const response = await worker.fetch(
                new Request(`${ORIGIN}${path}`, { method: "POST", body: CREATE_BODY }),
                env,
            );

            // /api%2Frooms は /api/ 配下ではないので API として扱われず、静的アセットの経路に落ちる
            if (path.startsWith("/api%2F")) {
                expect(await response.text()).toBe("asset");
            } else {
                expect(response.status).toBe(400);
                expect(response.headers.get("cache-control")).toBe("no-store");
                expect(await response.json()).toEqual({
                    error: "INVALID_REQUEST",
                    message: "Percent-encoded API paths are not supported",
                });
            }
            expect(backendCalls).toEqual([]);
            expect(rateLimitKeys).toEqual([]);
        });

        it.each([
            ["ルーム情報", "/api/rooms/room%30%31", {}],
            ["ルーム情報（rooms 側）", "/api/%72ooms/room01", {}],
            ["WebSocket", "/api/rooms/room01/%77s", { Upgrade: "websocket" }],
            ["WebSocket（rooms 側）", "/api/room%73/room01/ws", { Upgrade: "websocket" }],
            ["ルーム以外の API", "/api/auth/se%73sion", {}],
        ])("GET %s (%s) は backend に渡さない", async (_label, path, headers) => {
            const { env, backendCalls } = createEnv();

            const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), env);

            expect(response.status).toBe(400);
            expect(backendCalls).toEqual([]);
            const warned = warnSpy.mock.calls.map(([line]) => JSON.parse(String(line)));
            expect(warned).toContainEqual({
                event: "api_path_rejected",
                reason: "percent_encoded",
            });
            expect(JSON.stringify(warned)).not.toContain("room01");
        });

        it("クエリ文字列の percent-encode は拒否しない", async () => {
            const { env, backendCalls } = createEnv();

            const response = await worker.fetch(
                new Request(`${ORIGIN}/api/nnue/uploads/f1/parts/1?uploadId=a%2Fb%3D`),
                env,
            );

            expect(response.status).toBe(200);
            expect(backendCalls.map((call) => call.url)).toEqual([
                `${ORIGIN}/api/nnue/uploads/f1/parts/1?uploadId=a%2Fb%3D`,
            ]);
        });

        // URL の解釈で正規化される表記と、backend のルーターが /api/rooms とは別のパスとして扱う表記
        it.each([
            ["ドットセグメント", "/api/./rooms", "/api/rooms", true],
            ["親ディレクトリ", "/api/x/../rooms", "/api/rooms", true],
            ["エンコードされたドットセグメント", "/api/%2e/rooms", "/api/rooms", true],
            ["バックスラッシュ", "/api\\rooms", "/api/rooms", true],
            ["末尾スラッシュ", "/api/rooms/", "/api/rooms/", false],
            ["重複スラッシュ", "/api//rooms", "/api//rooms", false],
            ["大文字", "/api/Rooms", "/api/Rooms", false],
            ["パスパラメータ", "/api/rooms;x=1", "/api/rooms;x=1", false],
        ])("POST %s (%s) は %s として扱う", async (_label, path, normalizedPath, isCreate) => {
            const { env, backendCalls, rateLimitKeys } = createEnv();

            await worker.fetch(
                new Request(`${ORIGIN}${path}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        settings: {
                            startSfen: "startpos",
                            timeControl: { type: "byoyomi", initialMs: 0, byoyomiMs: 30_000 },
                        },
                    }),
                }),
                env,
            );

            // ルーム作成として扱うものは必ずレート制限を通り、それ以外は backend で作成にならないパスのまま転送する
            expect(rateLimitKeys).toHaveLength(isCreate ? 1 : 0);
            expect(backendCalls.map((call) => call.url)).toEqual([`${ORIGIN}${normalizedPath}`]);
        });
    });

    describe("backend への転送が例外になったとき", () => {
        function createFailingEnv() {
            const created = createEnv();
            const env = {
                ...created.env,
                BACKEND: {
                    fetch: async () => {
                        throw new Error(`fetch failed: ${ORIGIN}/api/rooms/secretRoom`);
                    },
                },
            } as unknown as WorkerEnv;
            return { ...created, env };
        }

        it.each([
            ["ルーム作成", () => createRoomRequest(), "create"],
            ["ルーム情報", () => new Request(`${ORIGIN}/api/rooms/secretRoom`), "info"],
            ["WebSocket", () => webSocketUpgradeRequest(), "ws"],
        ])("%sは 502 を返し、失敗を 1 行で記録する", async (_label, makeRequest, route) => {
            const { env } = createFailingEnv();

            const response = await worker.fetch(makeRequest(), env);

            expect(response.status).toBe(502);
            expect(response.headers.get("Content-Type")).toBe("application/json");
            expect(response.headers.get("cache-control")).toBe("no-store");
            expect(await response.json()).toEqual({
                error: "BACKEND_UNAVAILABLE",
                message: "Room service is temporarily unavailable. Please try again later.",
            });
            expect(roomRequestLogs(logSpy)).toEqual([
                {
                    event: "room_request",
                    served_by: "backend",
                    route,
                    method: route === "create" ? "POST" : "GET",
                    status: 502,
                    error: "backend_fetch_failed",
                },
            ]);
            expect(logSpy.mock.calls.flat().join("\n")).not.toMatch(/secretRoom|fetch failed/);
        });

        it("ルーム以外の API は例外をそのまま伝える", async () => {
            const { env } = createFailingEnv();

            await expect(
                worker.fetch(new Request(`${ORIGIN}/api/auth/session`), env),
            ).rejects.toThrow("fetch failed");
        });
    });

    it("ルーム以外の API はレート制限もログも無しで backend へ転送する", async () => {
        const { env, backendCalls, rateLimitKeys } = createEnv();

        await worker.fetch(new Request(`${ORIGIN}/api/auth/session`), env);
        await worker.fetch(new Request(`${ORIGIN}/api/roomsfoo`, { method: "POST" }), env);

        expect(backendCalls.map((call) => call.url)).toEqual([
            `${ORIGIN}/api/auth/session`,
            `${ORIGIN}/api/roomsfoo`,
        ]);
        expect(rateLimitKeys).toEqual([]);
        expect(roomRequestLogs(logSpy)).toEqual([]);
    });
});
