import {
    enforceRoomCreateRateLimit,
    handleLegacyRoomRequest,
    type Env as LegacyRoomEnv,
    type RoomBackend,
    resolveRoomBackend,
} from "./api";

export { RoomDO } from "./room-do";

interface Env extends LegacyRoomEnv {
    BACKEND?: Fetcher;
    BACKEND_ORIGIN?: string;
    /** ルーム API の処理先。"legacy" = この Worker の RoomDO、"backend" = backend Worker */
    ROOM_BACKEND?: string;
}

const NNUE_MANIFEST_PATH = "/nnue/manifest.json";
const NNUE_FILES_PREFIX = "/nnue/files/";
const API_PREFIX = "/api/";
const ROOMS_PATH = "/api/rooms";
const SECURITY_HEADERS: Record<string, string> = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
};
const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
};

function applyHeaders(headers: Headers, entries: Record<string, string>): void {
    for (const [key, value] of Object.entries(entries)) {
        headers.set(key, value);
    }
}

function withStandardHeaders(response: Response): Response {
    const headers = new Headers(response.headers);
    applyHeaders(headers, SECURITY_HEADERS);
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function withNnueHeaders(headers: Headers): void {
    applyHeaders(headers, SECURITY_HEADERS);
    applyHeaders(headers, CORS_HEADERS);
}

function resolveRange(range: R2Range, size: number): { start: number; end: number } {
    if ("suffix" in range) {
        const suffix = Math.min(range.suffix, size);
        return { start: size - suffix, end: size - 1 };
    }
    const start = range.offset ?? 0;
    const length = range.length ?? size - start;
    const end = Math.min(size - 1, start + length - 1);
    return { start, end };
}

function handleNnueOptions(): Response {
    const headers = new Headers();
    withNnueHeaders(headers);
    return new Response(null, { status: 204, headers });
}

function resolveBackendUrl(requestUrl: string, backendOrigin: string): URL | null {
    try {
        const url = new URL(requestUrl);
        const targetOrigin = new URL(backendOrigin);
        url.protocol = targetOrigin.protocol;
        url.hostname = targetOrigin.hostname;
        url.port = targetOrigin.port;
        return url;
    } catch {
        return null;
    }
}

async function handleApiProxyRequest(request: Request, env: Env): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith(API_PREFIX)) {
        return null;
    }

    const sourceUrl = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", sourceUrl.host);
    headers.set("X-Forwarded-Proto", sourceUrl.protocol.replace(":", ""));

    let backendResponse: Response;

    if (env.BACKEND) {
        // Service Binding 経由（workers.dev 間 fetch の制約なし）
        backendResponse = await env.BACKEND.fetch(request.url, {
            method: request.method,
            headers,
            body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
            redirect: "manual",
        });
    } else if (env.BACKEND_ORIGIN) {
        // HTTP proxy fallback
        const targetUrl = resolveBackendUrl(request.url, env.BACKEND_ORIGIN);
        if (!targetUrl) {
            return new Response(
                JSON.stringify({ error: "INTERNAL_ERROR", message: "Invalid BACKEND_ORIGIN" }),
                {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                },
            );
        }
        backendResponse = await fetch(targetUrl.toString(), {
            method: request.method,
            headers,
            body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
            redirect: "manual",
        });
    } else {
        return null;
    }

    // 101 は WebSocket を保持した応答で、作り直すと接続を引き継げない
    if (backendResponse.status === 101) {
        return backendResponse;
    }

    const responseHeaders = new Headers(backendResponse.headers);
    responseHeaders.set("cache-control", "no-store");
    return new Response(backendResponse.body, {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
        headers: responseHeaders,
    });
}

function apiErrorResponse(status: number, error: string, message: string): Response {
    return new Response(JSON.stringify({ error, message }), {
        status,
        headers: {
            "Content-Type": "application/json",
            "cache-control": "no-store",
        },
    });
}

function apiNotFoundResponse(): Response {
    return apiErrorResponse(404, "NOT_FOUND", "API endpoint not found");
}

type RoomRoute = "create" | "info" | "ws" | "other";
type RoomServedBy = RoomBackend | "rate_limiter" | "none";
type RoomRequestOutcome = { servedBy: RoomServedBy; response: Response; backendFailed?: true };

function classifyRoomRoute(method: string, pathname: string): RoomRoute {
    if (pathname === ROOMS_PATH) return method === "POST" ? "create" : "other";
    if (/^\/api\/rooms\/[^/]+\/ws$/.test(pathname)) return "ws";
    if (/^\/api\/rooms\/[^/]+$/.test(pathname)) return method === "GET" ? "info" : "other";
    return "other";
}

async function serveRoomRequest(
    request: Request,
    env: Env,
    roomBackend: RoomBackend,
    route: RoomRoute,
): Promise<RoomRequestOutcome> {
    // backend Worker にはレート制限の binding が無いので、処理先によらずここで掛ける
    if (route === "create") {
        const rateLimited = await enforceRoomCreateRateLimit(request, env);
        if (rateLimited) return { servedBy: "rate_limiter", response: rateLimited };
    }

    if (roomBackend === "legacy") {
        const legacyResponse = await handleLegacyRoomRequest(request, env);
        if (legacyResponse) return { servedBy: "legacy", response: legacyResponse };
    }

    try {
        const proxiedResponse = await handleApiProxyRequest(request, env);
        if (proxiedResponse) return { servedBy: "backend", response: proxiedResponse };
        return { servedBy: "none", response: apiNotFoundResponse() };
    } catch (error) {
        // legacy でここに来るのは RoomDO が扱わないルーム API だけなので、失敗の扱いは他の API と揃えておく
        if (roomBackend === "legacy") throw error;
        return {
            servedBy: "backend",
            backendFailed: true,
            response: apiErrorResponse(
                502,
                "BACKEND_UNAVAILABLE",
                "Room service is temporarily unavailable. Please try again later.",
            ),
        };
    }
}

async function handleRoomRequest(request: Request, env: Env): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    if (pathname !== ROOMS_PATH && !pathname.startsWith(`${ROOMS_PATH}/`)) {
        return null;
    }

    const roomBackend = resolveRoomBackend(env.ROOM_BACKEND);
    const route = classifyRoomRoute(request.method, pathname);
    const { servedBy, response, backendFailed } = await serveRoomRequest(
        request,
        env,
        roomBackend,
        route,
    );
    // ルーム ID は知っていれば参加できる値なので、パスやクエリは記録しない。
    // 転送に失敗したときの例外の文言も URL を含み得るので記録しない
    console.log(
        JSON.stringify({
            event: "room_request",
            served_by: servedBy,
            room_backend: roomBackend,
            route,
            method: request.method,
            status: response.status,
            ...(backendFailed ? { error: "backend_fetch_failed" } : {}),
        }),
    );
    return response;
}

async function handleNnueRequest(request: Request, env: Env): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    if (pathname !== NNUE_MANIFEST_PATH && !pathname.startsWith(NNUE_FILES_PREFIX)) {
        return null;
    }

    if (request.method === "OPTIONS") {
        return handleNnueOptions();
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        const headers = new Headers({ Allow: "GET, HEAD, OPTIONS" });
        withNnueHeaders(headers);
        return new Response("Method Not Allowed", { status: 405, headers });
    }

    if (pathname === NNUE_MANIFEST_PATH) {
        const object = await env.NNUE_BUCKET.get("manifest.json");
        if (!object) {
            const headers = new Headers();
            withNnueHeaders(headers);
            return new Response("Not Found", { status: 404, headers });
        }

        const headers = new Headers();
        headers.set("content-type", "application/json; charset=utf-8");
        headers.set("cache-control", "public, max-age=300");
        withNnueHeaders(headers);
        return new Response(request.method === "HEAD" ? null : object.body, {
            status: 200,
            headers,
        });
    }

    const key = pathname.slice(NNUE_FILES_PREFIX.length);
    if (!key) {
        const headers = new Headers();
        withNnueHeaders(headers);
        return new Response("Not Found", { status: 404, headers });
    }

    const object = await env.NNUE_BUCKET.get(key, { range: request.headers });
    if (!object) {
        const headers = new Headers();
        withNnueHeaders(headers);
        return new Response("Not Found", { status: 404, headers });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    if (!headers.has("content-type")) {
        headers.set("content-type", "application/octet-stream");
    }
    if (!headers.has("cache-control")) {
        headers.set("cache-control", "public, max-age=31536000, immutable");
    }
    headers.set("accept-ranges", "bytes");
    headers.set("etag", object.httpEtag);
    withNnueHeaders(headers);

    let status = 200;
    if (object.range) {
        const { start, end } = resolveRange(object.range, object.size);
        headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
        headers.set("content-length", String(end - start + 1));
        status = 206;
    } else {
        headers.set("content-length", String(object.size));
    }

    return new Response(request.method === "HEAD" ? null : object.body, {
        status,
        headers,
    });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const { pathname } = new URL(request.url);

        // backend のルーターはパスを percent-decode してから照合するので、エンコードされたパスは
        // ここでの判定（ルーム API の振り分けとルーム作成のレート制限）に掛からないまま backend の
        // ルーム API に届く。クライアントが使う API のパスにエンコードが要る文字は無いので受け付けない
        if (pathname.startsWith(API_PREFIX) && pathname.includes("%")) {
            console.warn(JSON.stringify({ event: "api_path_rejected", reason: "percent_encoded" }));
            return apiErrorResponse(
                400,
                "INVALID_REQUEST",
                "Percent-encoded API paths are not supported",
            );
        }

        // /api/rooms/* は ROOM_BACKEND に従い、この Worker の RoomDO か backend Worker で処理
        const roomResponse = await handleRoomRequest(request, env);
        if (roomResponse) return roomResponse;

        // その他の /api/* はバックエンド Worker にプロキシ
        const proxiedApiResponse = await handleApiProxyRequest(request, env);
        if (proxiedApiResponse) return proxiedApiResponse;

        if (pathname.startsWith(API_PREFIX)) {
            return apiNotFoundResponse();
        }

        const nnueResponse = await handleNnueRequest(request, env);
        if (nnueResponse) return nnueResponse;

        // 静的アセットを取得
        const response = await env.ASSETS.fetch(request);

        // /assets/* への SPA fallback（text/html）は本来存在しないファイルへのリクエスト
        // MIME type エラーを防ぐため 404 を返す
        if (
            pathname.startsWith("/assets/") &&
            response.headers.get("content-type")?.includes("text/html")
        ) {
            return new Response("Not Found", {
                status: 404,
                headers: { "cache-control": "no-store" },
            });
        }

        // レスポンスヘッダーを追加（WASM SharedArrayBuffer対応）
        return withStandardHeaders(response);
    },
};
