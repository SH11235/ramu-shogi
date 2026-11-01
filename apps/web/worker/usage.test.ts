// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { handleUsageRequest, type UsageEnv } from "./usage";

const ORIGIN = "https://app.example.test";
const DEVICE_ID = "3f2b8c1e-4d5a-4b6c-9d7e-0123456789ab";
const IPHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1";

function createEnv({ rateLimitAllowed = true } = {}) {
    const points: AnalyticsEngineDataPoint[] = [];
    const rateLimitKeys: string[] = [];
    const env: UsageEnv = {
        USAGE_EVENTS: { writeDataPoint: (point) => points.push(point ?? {}) },
        USAGE_RATE_LIMITER: {
            limit: async ({ key }) => {
                rateLimitKeys.push(key);
                return { success: rateLimitAllowed };
            },
        },
    };
    return { env, points, rateLimitKeys };
}

function usageRequest(body: BodyInit, headers: Record<string, string> = {}): Request {
    return new Request(`${ORIGIN}/usage`, {
        method: "POST",
        headers: {
            Origin: ORIGIN,
            "CF-Connecting-IP": "203.0.113.7",
            "User-Agent": IPHONE_UA,
            ...headers,
        },
        body,
    });
}

const matchEnd = JSON.stringify({
    v: 1,
    deviceId: DEVICE_ID,
    event: "match_end",
    props: { result: "loss", reason: "checkmate", plies: 120, durationSec: 1500 },
});

describe("POST /usage", () => {
    it("検証した 1 行を決まった列の並びで書き、204 を返す", async () => {
        const { env, points, rateLimitKeys } = createEnv();
        const response = await handleUsageRequest(usageRequest(matchEnd), env);
        expect(response?.status).toBe(204);
        expect(rateLimitKeys).toEqual(["203.0.113.7"]);
        expect(points).toEqual([
            {
                indexes: [DEVICE_ID],
                blobs: ["match_end", "XX", "mobile", "0", "0", "loss", "checkmate", "", "", "v1"],
                doubles: [120, 1500],
            },
        ]);
    });

    it("/usage 以外は扱わない", async () => {
        const { env } = createEnv();
        expect(
            await handleUsageRequest(new Request(`${ORIGIN}/usage/x`, { method: "POST" }), env),
        ).toBeNull();
    });

    it("POST 以外は 405", async () => {
        const { env, points } = createEnv();
        const response = await handleUsageRequest(new Request(`${ORIGIN}/usage`), env);
        expect(response?.status).toBe(405);
        expect(points).toEqual([]);
    });

    it.each([
        ["別のオリジン", () => usageRequest(matchEnd, { Origin: "https://evil.example" })],
        ["JSON でない本文", () => usageRequest("not json")],
        [
            "検証に通らない本文",
            () => usageRequest(JSON.stringify({ v: 1, deviceId: DEVICE_ID, event: "x" })),
        ],
        ["上限を超える本文", () => usageRequest(`${matchEnd}${" ".repeat(4096)}`)],
    ])("書き込まずに 204: %s", async (_, makeRequest) => {
        const { env, points } = createEnv();
        const response = await handleUsageRequest(makeRequest(), env);
        expect(response?.status).toBe(204);
        expect(points).toEqual([]);
    });

    it("レート制限を超えたら書き込まない", async () => {
        const { env, points } = createEnv({ rateLimitAllowed: false });
        expect((await handleUsageRequest(usageRequest(matchEnd), env))?.status).toBe(204);
        expect(points).toEqual([]);
    });

    it("書き込み先の無い環境では受け取って捨てる", async () => {
        const response = await handleUsageRequest(usageRequest(matchEnd), {});
        expect(response?.status).toBe(204);
    });

    it("Origin の無い送信も受け付ける", async () => {
        const { env, points } = createEnv();
        const request = new Request(`${ORIGIN}/usage`, { method: "POST", body: matchEnd });
        await handleUsageRequest(request, env);
        expect(points[0]?.blobs?.[2]).toBe("desktop");
    });

    it("Content-Length が上限を超えたら本文を読まない", async () => {
        const { env, points } = createEnv();
        const request = usageRequest(matchEnd, { "Content-Length": "4096" });
        expect((await handleUsageRequest(request, env))?.status).toBe(204);
        expect(points).toEqual([]);
    });

    it.each([
        [
            "本文の読み取りが切れる",
            (env: UsageEnv) => ({
                env,
                request: new Request(`${ORIGIN}/usage`, {
                    method: "POST",
                    body: new ReadableStream({
                        pull(controller) {
                            controller.error(new Error("connection reset"));
                        },
                    }),
                    // Node の fetch 実装はストリームの本文に duplex の指定を求める
                    duplex: "half",
                } as RequestInit),
            }),
        ],
        [
            "レート制限が例外を投げる",
            (env: UsageEnv) => ({
                env: {
                    ...env,
                    USAGE_RATE_LIMITER: {
                        limit: async () => {
                            throw new Error("unavailable");
                        },
                    },
                },
                request: usageRequest(matchEnd),
            }),
        ],
    ])("例外でも書き込まずに 204: %s", async (_, setup) => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { env: baseEnv, points } = createEnv();
        const { env, request } = setup(baseEnv);
        expect((await handleUsageRequest(request, env))?.status).toBe(204);
        expect(points).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(JSON.stringify({ event: "usage_event_failed" }));
        warnSpy.mockRestore();
    });

    describe("AI の名前", () => {
        const download = (ai: string) =>
            usageRequest(
                JSON.stringify({
                    v: 1,
                    deviceId: DEVICE_ID,
                    event: "nnue_download",
                    props: { ai },
                }),
            );
        const bucket = (manifest: unknown) => ({
            get: async (key: string) =>
                key === "manifest.json" && manifest !== null
                    ? { json: async () => manifest }
                    : null,
        });

        it("manifest の配布 AI と固定の名前だけを書く", async () => {
            const { env, points } = createEnv();
            const withBucket = {
                ...env,
                NNUE_BUCKET: bucket({ presets: [{ presetKey: "coco" }] }),
            } as unknown as UsageEnv;
            for (const ai of ["coco", "custom", "alice"]) {
                await handleUsageRequest(download(ai), withBucket);
            }
            expect(points.map((point) => point.blobs?.[5])).toEqual(["coco", "custom"]);
        });

        it("manifest が壊れていても、ほかのイベントは書く", async () => {
            const { env, points } = createEnv();
            const broken = {
                get: async () => ({
                    json: async () => {
                        throw new SyntaxError("Unexpected token");
                    },
                }),
            };
            await handleUsageRequest(usageRequest(matchEnd), {
                ...env,
                NNUE_BUCKET: broken,
            } as unknown as UsageEnv);
            expect(points).toHaveLength(1);
        });

        it("manifest が無ければ固定の名前だけを書く", async () => {
            const { env, points } = createEnv();
            const withBucket = { ...env, NNUE_BUCKET: bucket(null) } as unknown as UsageEnv;
            await handleUsageRequest(download("coco"), withBucket);
            await handleUsageRequest(download("material"), withBucket);
            expect(points.map((point) => point.blobs?.[5])).toEqual(["material"]);
        });
    });
});
