import { handleApiRequest } from "./api";

// RoomDO は T-102 で実装予定（export が必要なため仮定義）
export { RoomDO } from "./room-do";

interface Env {
    ASSETS: Fetcher;
    NNUE_BUCKET: R2Bucket;
    ROOM: DurableObjectNamespace;
}

const NNUE_MANIFEST_PATH = "/nnue/manifest.json";
const NNUE_FILES_PREFIX = "/nnue/files/";
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
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // /api/* リクエストを API ハンドラにルーティング
        const apiResponse = await handleApiRequest(request, env, ctx);
        if (apiResponse) return apiResponse;

        const nnueResponse = await handleNnueRequest(request, env);
        if (nnueResponse) return nnueResponse;

        // 静的アセットを取得
        const response = await env.ASSETS.fetch(request);

        // レスポンスヘッダーを追加（WASM SharedArrayBuffer対応）
        return withStandardHeaders(response);
    },
};
