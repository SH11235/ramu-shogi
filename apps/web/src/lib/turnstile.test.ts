import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTurnstile, requestTurnstileToken, type TurnstileApi } from "./turnstile";

type RenderOptions = Parameters<TurnstileApi["render"]>[1];

function createFakeApi(onRender: (options: RenderOptions) => void) {
    const removed: string[] = [];
    const api: TurnstileApi = {
        render: (_container, options) => {
            onRender(options);
            return "widget-1";
        },
        remove: (id) => removed.push(id),
    };
    return { api, removed };
}

describe("requestTurnstileToken", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("callback のトークンを返し、ウィジェットを外す", async () => {
        vi.useFakeTimers();
        let options: RenderOptions | undefined;
        const { api, removed } = createFakeApi((o) => {
            options = o;
        });
        const promise = requestTurnstileToken(api, document.createElement("div"), "sitekey");
        options?.callback?.("token-1");
        await expect(promise).resolves.toBe("token-1");
        vi.runAllTimers();
        expect(removed).toEqual(["widget-1"]);
        expect(options).toMatchObject({ sitekey: "sitekey", appearance: "interaction-only" });
    });

    it.each([
        "error-callback",
        "timeout-callback",
    ] as const)("%s ではトークンなしで返し、送信の判断をサーバーに任せる", async (name) => {
        let options: RenderOptions | undefined;
        const { api } = createFakeApi((o) => {
            options = o;
        });
        const promise = requestTurnstileToken(api, document.createElement("div"), "sitekey");
        if (name === "error-callback") options?.[name]?.("110200");
        else options?.[name]?.();
        await expect(promise).resolves.toBeUndefined();
    });

    it("後から来た callback で結果を上書きしない", async () => {
        let options: RenderOptions | undefined;
        const { api } = createFakeApi((o) => {
            options = o;
        });
        const promise = requestTurnstileToken(api, document.createElement("div"), "sitekey");
        options?.["error-callback"]?.("110200");
        options?.callback?.("late-token");
        await expect(promise).resolves.toBeUndefined();
    });

    it("render が例外を投げたらトークンなしで返す", async () => {
        const api: TurnstileApi = {
            render: () => {
                throw new Error("invalid sitekey");
            },
            remove: () => undefined,
        };
        await expect(
            requestTurnstileToken(api, document.createElement("div"), "sitekey"),
        ).resolves.toBeUndefined();
    });

    it("操作の要らない判定が期限までに終わらなければトークンなしで返す", async () => {
        vi.useFakeTimers();
        const { api, removed } = createFakeApi(() => undefined);
        const promise = requestTurnstileToken(api, document.createElement("div"), "sitekey");
        vi.advanceTimersByTime(15_000);
        await expect(promise).resolves.toBeUndefined();
        vi.runAllTimers();
        expect(removed).toEqual(["widget-1"]);
    });

    it("操作を求められたら期限で打ち切らない", async () => {
        vi.useFakeTimers();
        let options: RenderOptions | undefined;
        const { api } = createFakeApi((o) => {
            options = o;
        });
        const promise = requestTurnstileToken(api, document.createElement("div"), "sitekey");
        options?.["before-interactive-callback"]?.();
        vi.advanceTimersByTime(60_000);
        options?.callback?.("token-after-click");
        await expect(promise).resolves.toBe("token-after-click");
    });

    it("中断されたらトークンなしで返し、ウィジェットを外す", async () => {
        vi.useFakeTimers();
        const { api, removed } = createFakeApi(() => undefined);
        const abort = new AbortController();
        const promise = requestTurnstileToken(
            api,
            document.createElement("div"),
            "sitekey",
            abort.signal,
        );
        abort.abort();
        await expect(promise).resolves.toBeUndefined();
        vi.runAllTimers();
        expect(removed).toEqual(["widget-1"]);
    });
});

describe("loadTurnstile", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("script が期限までに読めなければ失敗し、次の呼び出しで読み直す", async () => {
        vi.useFakeTimers();
        // 応答が返らない読み込みを再現するため、head には入れずに受け取るだけにする
        const appended: Node[] = [];
        vi.spyOn(document.head, "appendChild").mockImplementation(<T extends Node>(node: T) => {
            appended.push(node);
            return node;
        });
        const first = loadTurnstile(1000);
        vi.advanceTimersByTime(1000);
        await expect(first).rejects.toThrow("timed out");

        const second = loadTurnstile(1000);
        expect(second).not.toBe(first);
        expect(appended).toHaveLength(2);
        vi.advanceTimersByTime(1000);
        await expect(second).rejects.toThrow("timed out");
    });
});
