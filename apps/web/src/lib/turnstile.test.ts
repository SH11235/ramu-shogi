import { afterEach, describe, expect, it, vi } from "vitest";
import { requestTurnstileToken, type TurnstileApi } from "./turnstile";

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
});
