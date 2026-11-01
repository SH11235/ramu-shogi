import { describe, expect, it } from "vitest";
import { parseUsageEvent } from "../../worker/usage-events";
import { createUsageClient } from "./usage";

const DEVICE_ID = "3f2b8c1e-4d5a-4b6c-9d7e-0123456789ab";

function setup({
    hostname = "ramu-shogi.sh11235.com",
    search = "",
    referrer = "",
    storage = new Map<string, string>(),
    noStorage = false,
    automated = false,
} = {}) {
    const sent: { path: string; body: Record<string, unknown> }[] = [];
    const client = createUsageClient({
        hostname,
        search,
        referrer,
        automated,
        storage: noStorage
            ? null
            : {
                  getItem: (key) => storage.get(key) ?? null,
                  setItem: (key, value) => void storage.set(key, value),
                  removeItem: (key) => void storage.delete(key),
              },
        randomUUID: () => DEVICE_ID,
        send: (path, body) => sent.push({ path, body: JSON.parse(body) }),
    });
    return { client, sent, storage };
}

const accepted = (body: unknown) => parseUsageEvent(body, { aiNames: new Set(["material"]) });

describe("createUsageClient", () => {
    it("本番では端末 ID を作って保存し、Worker の検証に通る本文を送る", () => {
        const { client, sent, storage } = setup();
        client.track("analysis_start", { kind: "single" });
        expect(sent).toEqual([
            {
                path: "/usage",
                body: {
                    v: 1,
                    deviceId: DEVICE_ID,
                    event: "analysis_start",
                    props: { kind: "single" },
                },
            },
        ]);
        expect(storage.get("ramu.usage.deviceId")).toBe(DEVICE_ID);
        expect(accepted(sent[0]?.body)).not.toBeNull();
    });

    it("保存済みの端末 ID を使い続ける", () => {
        const existing = "11111111-2222-4333-8444-555555555555";
        const { client, sent } = setup({ storage: new Map([["ramu.usage.deviceId", existing]]) });
        client.track("hint_request");
        expect(sent[0]?.body.deviceId).toBe(existing);
    });

    it.each([
        ["本番以外のホスト", { hostname: "stg.ramu-shogi.sh11235.com" }],
        ["localhost", { hostname: "localhost" }],
        ["端末内に保存できない", { noStorage: true }],
    ])("送らない: %s", (_, options) => {
        const { client, sent } = setup(options);
        client.track("hint_request");
        expect(sent).toEqual([]);
    });

    it("送らない環境では端末 ID を作らない", () => {
        const { client, storage } = setup({ hostname: "localhost" });
        client.trackPageView("/", "/");
        expect(storage.size).toBe(0);
    });

    it("?internal=1 の印を残し、?internal=0 で外す", () => {
        const storage = new Map<string, string>();
        setup({ storage, search: "?internal=1" }).client.track("hint_request");
        const marked = setup({ storage });
        marked.client.track("hint_request");
        expect(marked.sent[0]?.body.internal).toBe(true);

        setup({ storage, search: "?internal=0" });
        const unmarked = setup({ storage });
        unmarked.client.track("hint_request");
        expect(unmarked.sent[0]?.body).not.toHaveProperty("internal");
    });

    it("自動操作のブラウザは internal の印を付けて送る", () => {
        const { client, sent } = setup({ automated: true });
        client.track("hint_request");
        expect(sent[0]?.body.internal).toBe(true);
    });

    it("ログイン中かどうかを付ける", () => {
        const { client, sent } = setup();
        client.setLoggedIn(true);
        client.track("hint_request");
        expect(sent[0]?.body.loggedIn).toBe(true);
    });

    describe("page_view", () => {
        it("同じパスは 1 回だけ送り、外部の参照元は最初の 1 回だけ付ける", () => {
            const { client, sent } = setup({ referrer: "https://t.co/abc" });
            client.trackPageView("/", "/");
            client.trackPageView("/", "/");
            client.trackPageView("/games/$gameId", "/games/aaa");
            client.trackPageView("/games/$gameId", "/games/aaa");
            client.trackPageView("/games/$gameId", "/games/bbb");
            expect(sent.map(({ body }) => body.props)).toEqual([
                { route: "/", referrer: "t.co" },
                { route: "/games/$gameId" },
                { route: "/games/$gameId" },
            ]);
            expect(sent.every(({ body }) => accepted(body) !== null)).toBe(true);
        });

        it.each([
            "http://localhost:5173/",
            "http://192.168.1.10/",
            "http://[::1]/",
        ])("手元や LAN 内の参照元は付けない: %s", (referrer) => {
            const { client, sent } = setup({ referrer });
            client.trackPageView("/", "/");
            expect(sent[0]?.body.props).toEqual({ route: "/" });
        });

        it("自分のサイトからの参照元は付けない", () => {
            const { client, sent } = setup({ referrer: "https://ramu-shogi.sh11235.com/play" });
            client.trackPageView("/", "/");
            expect(sent[0]?.body.props).toEqual({ route: "/" });
        });

        it("知らないルートは送らない", () => {
            const { client, sent } = setup();
            client.trackPageView("__root__", "/no-such-page");
            expect(sent).toEqual([]);
        });
    });

    it("送信の失敗で例外を外に出さない", () => {
        const storage = new Map<string, string>();
        let attempts = 0;
        const client = createUsageClient({
            hostname: "ramu-shogi.sh11235.com",
            search: "",
            referrer: "",
            automated: false,
            storage: {
                getItem: (key) => storage.get(key) ?? null,
                setItem: (key, value) => void storage.set(key, value),
                removeItem: (key) => void storage.delete(key),
            },
            randomUUID: () => DEVICE_ID,
            send: () => {
                attempts += 1;
                throw new Error("offline");
            },
        });
        expect(() => client.track("hint_request")).not.toThrow();
        expect(attempts).toBe(1);
    });
});
