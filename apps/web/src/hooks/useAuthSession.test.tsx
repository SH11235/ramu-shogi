import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITED_MESSAGE } from "../lib/rateLimitMessage";
import {
    AUTH_SESSION_TIMEOUT_MS,
    AuthSessionProvider,
    parseApiError,
    useAuthSession,
} from "./useAuthSession";

describe("parseApiError", () => {
    it("429 は本文の英語の message ではなく日本語の文言を返す", async () => {
        const response = Response.json(
            { error: "RATE_LIMITED", message: "Too many requests. Please try again later." },
            { status: 429 },
        );
        expect(await parseApiError(response)).toBe(RATE_LIMITED_MESSAGE);
    });

    it("zone のレート制限で本文が HTML の 429 でも日本語の文言を返す", async () => {
        const response = new Response("<!DOCTYPE html><title>Error 1015</title>", {
            status: 429,
            headers: { "Content-Type": "text/html" },
        });
        expect(await parseApiError(response)).toBe(RATE_LIMITED_MESSAGE);
    });

    it("429 以外は本文の message を返す", async () => {
        const response = Response.json(
            { error: "INVALID_REQUEST", message: "表示名が長すぎます" },
            { status: 400 },
        );
        expect(await parseApiError(response)).toBe("表示名が長すぎます");
    });
});

describe("AuthSessionProvider", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthSessionProvider>{children}</AuthSessionProvider>
    );
    const signedIn = (id: string) =>
        Response.json({ authenticated: true, user: { id, username: id, displayName: id } });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("ログイン状態の問い合わせが返らなければ、時間切れで確認中を終える", async () => {
        vi.useFakeTimers();
        vi.stubGlobal(
            "fetch",
            vi.fn(() => new Promise<Response>(() => undefined)),
        );
        const { result } = renderHook(() => useAuthSession(), { wrapper });
        expect(result.current.isLoadingSession).toBe(true);
        await act(() => vi.advanceTimersByTimeAsync(AUTH_SESSION_TIMEOUT_MS));
        expect(result.current.isLoadingSession).toBe(false);
        expect(result.current.sessionError).toContain("時間切れ");
        expect(result.current.session).toBeNull();
    });

    it("取り直しが重なったら、あとから始めた問い合わせの結果を使う", async () => {
        const pending: Array<(response: Response) => void> = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(
                () =>
                    new Promise<Response>((resolve) => {
                        pending.push(resolve);
                    }),
            ),
        );
        const { result } = renderHook(() => useAuthSession(), { wrapper });
        await act(async () => {
            pending[0](signedIn("user-a"));
        });
        // 別のタブで B に切り替わったあとの取り直しが 2 回重なり、先に始めた方が遅れて返る。
        let first: Promise<void> = Promise.resolve();
        let second: Promise<void> = Promise.resolve();
        act(() => {
            first = result.current.refreshSession();
            second = result.current.refreshSession();
        });
        await act(async () => {
            pending[2](signedIn("user-b"));
            await second;
        });
        await act(async () => {
            pending[1](signedIn("user-a"));
            await first;
        });
        expect(result.current.session).toMatchObject({ user: { id: "user-b" } });
        expect(result.current.isLoadingSession).toBe(false);
    });

    it("取り直しを始めたら、前の問い合わせを中止する", async () => {
        const signals: AbortSignal[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
                if (init?.signal) signals.push(init.signal);
                return new Promise<Response>(() => undefined);
            }),
        );
        const { result } = renderHook(() => useAuthSession(), { wrapper });
        act(() => {
            void result.current.refreshSession();
        });
        expect(signals).toHaveLength(2);
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);
        expect(result.current.isLoadingSession).toBe(true);
    });
});
