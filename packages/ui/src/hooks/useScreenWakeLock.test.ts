import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScreenWakeLock } from "./useScreenWakeLock";

interface FakeSentinel {
    released: boolean;
    release: ReturnType<typeof vi.fn>;
}

let sentinels: FakeSentinel[];
let request: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState;

const flush = () => act(async () => {});

beforeEach(() => {
    sentinels = [];
    visibility = "visible";
    request = vi.fn(async () => {
        const sentinel: FakeSentinel = {
            released: false,
            release: vi.fn(async () => {
                sentinel.released = true;
            }),
        };
        sentinels.push(sentinel);
        return sentinel;
    });
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    Object.defineProperty(document, "visibilityState", {
        get: () => visibility,
        configurable: true,
    });
});

afterEach(() => {
    Reflect.deleteProperty(navigator, "wakeLock");
    Reflect.deleteProperty(document, "visibilityState");
});

describe("useScreenWakeLock", () => {
    it("有効な間だけ画面のロックを取り、無効になったら手放す", async () => {
        const { rerender } = renderHook(({ active }) => useScreenWakeLock(active), {
            initialProps: { active: false },
        });
        await flush();
        expect(request).not.toHaveBeenCalled();

        rerender({ active: true });
        await flush();
        expect(request).toHaveBeenCalledWith("screen");
        expect(sentinels).toHaveLength(1);

        rerender({ active: false });
        await flush();
        expect(sentinels[0].release).toHaveBeenCalled();
    });

    it("別のタブから戻ってきたら取り直す（ブラウザが解除したあと）", async () => {
        renderHook(() => useScreenWakeLock(true));
        await flush();
        expect(sentinels).toHaveLength(1);

        // 隠れている間にブラウザが解除する。
        visibility = "hidden";
        sentinels[0].released = true;
        document.dispatchEvent(new Event("visibilitychange"));
        await flush();
        expect(sentinels).toHaveLength(1);

        visibility = "visible";
        document.dispatchEvent(new Event("visibilitychange"));
        await flush();
        expect(sentinels).toHaveLength(2);
    });

    it("まだ持っている間は取り直さない", async () => {
        renderHook(() => useScreenWakeLock(true));
        await flush();
        document.dispatchEvent(new Event("visibilitychange"));
        await flush();
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("取る途中で無効になったら、取れたロックをすぐ手放す", async () => {
        let resolve: (sentinel: FakeSentinel) => void = () => {};
        request.mockImplementationOnce(
            () =>
                new Promise<FakeSentinel>((r) => {
                    resolve = r;
                }),
        );
        const { unmount } = renderHook(() => useScreenWakeLock(true));
        unmount();
        const late: FakeSentinel = { released: false, release: vi.fn(async () => {}) };
        await act(async () => {
            resolve(late);
        });
        expect(late.release).toHaveBeenCalled();
    });

    it("断られても例外を外へ出さない", async () => {
        request.mockRejectedValueOnce(new Error("NotAllowedError"));
        renderHook(() => useScreenWakeLock(true));
        await flush();
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("対応していないブラウザでは何もしない", async () => {
        Reflect.deleteProperty(navigator, "wakeLock");
        expect(() => renderHook(() => useScreenWakeLock(true))).not.toThrow();
    });
});
