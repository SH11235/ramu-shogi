import { describe, expect, it } from "vitest";
import { createStudyApiClient } from "./api-client";
import type { CreateStudyRequest } from "./api-types";
import { createTestDocument, TEST_STUDY_ID } from "./sync-test-support";

interface Recorded {
    url: string;
    init: RequestInit | undefined;
}

const createFetch = (respond: () => Response | Promise<Response>) => {
    const requests: Recorded[] = [];
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return respond();
    }) as typeof fetch;
    return { fetchMock, requests };
};

const RATE_LIMITED_MESSAGE = "操作が多すぎます。しばらく待ってからお試しください";

const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });

describe("createStudyApiClient", () => {
    it("6 本の API を、同一オリジン・Cookie つき・JSON で呼ぶ", async () => {
        const { fetchMock, requests } = createFetch(() => json(200, {}));
        const api = createStudyApiClient({ fetch: fetchMock });
        const doc = createTestDocument();
        const createBody: CreateStudyRequest = {
            id: doc.id,
            title: doc.title,
            origin: doc.origin,
            startSfen: doc.startSfen,
            rules: doc.rules,
            meta: doc.meta,
            tree: doc.tree,
            layers: [],
        };
        const opsBody = {
            batchId: "ec029a57-476a-41a6-b95b-a8dcfbf54232",
            expectedRevision: 12,
            ops: [{ type: "setTitle", value: "表題" } as const],
        };

        await api.list({
            limit: 20,
            cursor: "c1",
            originKind: "rshogi_csa",
            originRef: "wdoor 1/2",
        });
        await api.list();
        await api.create(createBody);
        await api.get(TEST_STUDY_ID);
        await api.postOps(TEST_STUDY_ID, opsBody);
        await api.delete(TEST_STUDY_ID);
        await api.limits();

        expect(requests.map((request) => [request.init?.method, request.url])).toEqual([
            ["GET", "/api/studies?limit=20&cursor=c1&originKind=rshogi_csa&originRef=wdoor+1%2F2"],
            ["GET", "/api/studies"],
            ["POST", "/api/studies"],
            ["GET", `/api/studies/${TEST_STUDY_ID}`],
            ["POST", `/api/studies/${TEST_STUDY_ID}/ops`],
            ["DELETE", `/api/studies/${TEST_STUDY_ID}`],
            ["GET", "/api/studies/limits"],
        ]);
        for (const request of requests) {
            expect(request.init?.credentials).toBe("same-origin");
        }
        expect(requests[2].init?.headers).toEqual({ "Content-Type": "application/json" });
        expect(JSON.parse(requests[2].init?.body as string)).toEqual(createBody);
        expect(JSON.parse(requests[4].init?.body as string)).toEqual(opsBody);
        // 本文の無い呼び出しには Content-Type を付けない。
        expect(requests[3].init?.headers).toBeUndefined();
        expect(requests[3].init?.body).toBeUndefined();
    });

    it("成功の応答はステータスつきで返す（201 と 200 existing を区別できる）", async () => {
        const created = createFetch(() => json(201, { studyId: TEST_STUDY_ID, revision: 1 }));
        expect(await createStudyApiClient({ fetch: created.fetchMock }).get(TEST_STUDY_ID)).toEqual(
            { ok: true, status: 201, data: { studyId: TEST_STUDY_ID, revision: 1 } },
        );

        const deleted = createFetch(() => new Response(null, { status: 204 }));
        expect(
            await createStudyApiClient({ fetch: deleted.fetchMock }).delete(TEST_STUDY_ID),
        ).toEqual({ ok: true, status: 204, data: null });
    });

    it("エラーの応答は例外にせず、ステータスと本文を返す", async () => {
        const conflict = createFetch(() =>
            json(409, { error: "REVISION_CONFLICT", currentRevision: 14 }),
        );
        expect(
            await createStudyApiClient({ fetch: conflict.fetchMock }).postOps(TEST_STUDY_ID, {
                batchId: "ec029a57-476a-41a6-b95b-a8dcfbf54232",
                expectedRevision: 12,
                ops: [],
            }),
        ).toEqual({
            ok: false,
            status: 409,
            error: { error: "REVISION_CONFLICT", currentRevision: 14 },
        });

        // 本文が JSON でないエラー（プロキシの 502 など）。
        const gateway = createFetch(() => new Response("Bad Gateway", { status: 502 }));
        expect(await createStudyApiClient({ fetch: gateway.fetchMock }).limits()).toEqual({
            ok: false,
            status: 502,
            error: {},
        });
    });

    it("429 は本文の英語の message を、画面に出す日本語の文言に差し替える", async () => {
        const limited = createFetch(() =>
            json(429, { error: "RATE_LIMITED", message: "Rate limited" }),
        );
        expect(
            await createStudyApiClient({ fetch: limited.fetchMock }).delete(TEST_STUDY_ID),
        ).toEqual({
            ok: false,
            status: 429,
            error: { error: "RATE_LIMITED", message: RATE_LIMITED_MESSAGE },
        });
    });

    it("zone のレート制限で本文が HTML の 429 も、日本語の文言を返す", async () => {
        const limited = createFetch(
            () =>
                new Response("<!DOCTYPE html><title>Error 1015</title>", {
                    status: 429,
                    headers: { "Content-Type": "text/html" },
                }),
        );
        expect(await createStudyApiClient({ fetch: limited.fetchMock }).get(TEST_STUDY_ID)).toEqual(
            { ok: false, status: 429, error: { message: RATE_LIMITED_MESSAGE } },
        );
    });

    it("通信できなかった場合は status 0 を返す", async () => {
        const offline = createFetch(() => {
            throw new TypeError("Failed to fetch");
        });
        expect(await createStudyApiClient({ fetch: offline.fetchMock }).get(TEST_STUDY_ID)).toEqual(
            {
                ok: false,
                status: 0,
                error: { error: "NETWORK_ERROR", message: "Failed to fetch" },
            },
        );
    });

    it("baseUrl を指定できる", async () => {
        const { fetchMock, requests } = createFetch(() => json(200, {}));
        await createStudyApiClient({ fetch: fetchMock, baseUrl: "https://api.example" }).limits();
        expect(requests[0].url).toBe("https://api.example/api/studies/limits");
    });
});
