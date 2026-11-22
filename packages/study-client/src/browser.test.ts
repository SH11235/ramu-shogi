import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionVerifier } from "./browser";

const jsonResponse = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200 });

describe("createSessionVerifier", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("ログイン中ならユーザー、未ログイン・backend 未接続（404）なら null を返す", async () => {
        const responses = [
            jsonResponse({ authenticated: true, user: { id: "user-a" } }),
            jsonResponse({ authenticated: false, user: null }),
            new Response(null, { status: 404 }),
        ];
        const verify = createSessionVerifier({ fetch: async () => responses.shift() as Response });
        expect(await verify()).toEqual({ userId: "user-a" });
        expect(await verify()).toBeNull();
        expect(await verify()).toBeNull();
    });

    it("問い合わせが返らなければ、時間切れで拒否し、問い合わせを中止する", async () => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        const verify = createSessionVerifier({
            timeoutMs: 1000,
            fetch: (_input, init) => {
                signal = init?.signal ?? undefined;
                return new Promise<Response>(() => undefined);
            },
        });
        const verifying = verify();
        const rejected = expect(verifying).rejects.toThrow("時間切れ");
        await vi.advanceTimersByTimeAsync(1000);
        await rejected;
        expect(signal?.aborted).toBe(true);
    });
});
