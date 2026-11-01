import {
    parseUsageEvent,
    USAGE_EVENTS_PATH,
    USAGE_MAX_BODY_BYTES,
    USAGE_SCHEMA_VERSION,
} from "./usage-events";

export type UsageEnv = {
    /** 利用状況のイベントの書き込み先。無い環境（ローカル開発など）では受け取って捨てる */
    USAGE_EVENTS?: AnalyticsEngineDataset;
    USAGE_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

const MAX_TEXT_FIELDS = 4;
const MAX_NUMBER_FIELDS = 2;

// 送り手は sendBeacon で、応答を読まない。受け付けなかった理由を返すと、不正な送信を試す側に
// 手掛かりを与えるだけなので、POST には常に 204 を返す
const accepted = () =>
    new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

function deviceType(userAgent: string): string {
    if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) return "tablet";
    if (/Mobi|iPhone|Android/i.test(userAgent)) return "mobile";
    return "desktop";
}

async function readBody(request: Request): Promise<string | null> {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > USAGE_MAX_BODY_BYTES || !request.body) return null;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > USAGE_MAX_BODY_BYTES) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

/**
 * POST /usage を受けて Analytics Engine に 1 行書く。集計の SQL は列の位置で読むので、並びを変えるときは
 * USAGE_SCHEMA_VERSION を上げる。
 * - indexes: [端末 ID]（サンプリングが端末単位になり、人数が崩れない）
 * - blobs: [イベント, 国, 端末の種類, internal, loggedIn, 項目 1〜4, スキーマの版]
 * - doubles: [数値の項目 1〜2]
 * IP と User-Agent の文字列は書かない。
 */
export async function handleUsageRequest(
    request: Request,
    env: UsageEnv,
): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname !== USAGE_EVENTS_PATH) return null;
    if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    }
    if (!env.USAGE_EVENTS) return accepted();

    const origin = request.headers.get("Origin");
    if (origin !== null && origin !== url.origin) return accepted();

    if (env.USAGE_RATE_LIMITER) {
        const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
        const { success } = await env.USAGE_RATE_LIMITER.limit({ key: ip });
        if (!success) return accepted();
    }

    const text = await readBody(request);
    if (text === null) return accepted();
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return accepted();
    }
    const parsed = parseUsageEvent(json);
    if (!parsed) return accepted();

    const texts = [...parsed.texts, ...Array(MAX_TEXT_FIELDS).fill("")].slice(0, MAX_TEXT_FIELDS);
    const numbers = [...parsed.numbers, ...Array(MAX_NUMBER_FIELDS).fill(0)].slice(
        0,
        MAX_NUMBER_FIELDS,
    );
    const country = (request.cf?.country as string | undefined) ?? "XX";
    env.USAGE_EVENTS.writeDataPoint({
        indexes: [parsed.deviceId],
        blobs: [
            parsed.event,
            country,
            deviceType(request.headers.get("User-Agent") ?? ""),
            parsed.internal ? "1" : "0",
            parsed.loggedIn ? "1" : "0",
            ...texts,
            `v${USAGE_SCHEMA_VERSION}`,
        ],
        doubles: numbers,
    });
    return accepted();
}
