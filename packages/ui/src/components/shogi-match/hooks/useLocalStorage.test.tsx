import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    dispatchLocalStorageSyncEvent,
    LOCAL_STORAGE_SYNC_EVENT,
    type LocalStorageSyncDetail,
    useLocalStorage,
} from "./useLocalStorage";

const KEY = "storage-source-test";
const defaults = { sound: true, volume: 1 };
let notifications: LocalStorageSyncDetail[];

function collectNotification(event: Event): void {
    notifications.push((event as CustomEvent<LocalStorageSyncDetail>).detail);
}

describe("useLocalStorage change source", () => {
    beforeEach(() => {
        localStorage.clear();
        notifications = [];
        window.addEventListener(LOCAL_STORAGE_SYNC_EVENT, collectNotification);
    });

    afterEach(() => {
        cleanup();
        window.removeEventListener(LOCAL_STORAGE_SYNC_EVENT, collectNotification);
    });

    it.each([
        false,
        true,
    ])("初期保存と同じ値の再描画は通知しない（StrictMode: %s）", (reactStrictMode) => {
        const { result, rerender } = renderHook(() => useLocalStorage(KEY, defaults), {
            reactStrictMode,
        });
        const setter = result.current[1];
        act(() => result.current[1]((previous) => previous));
        rerender();
        expect(notifications).toEqual([]);
        expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual(defaults);
        expect(result.current[1]).toBe(setter);
    });

    it("自動更新を他のhookへ伝えても利用者編集の通知に変えない", () => {
        const first = renderHook(() => useLocalStorage(KEY, defaults));
        const second = renderHook(() => useLocalStorage(KEY, defaults));
        act(() => first.result.current[1]({ sound: false, volume: 1 }, "automatic"));
        expect(second.result.current[0]).toEqual({ sound: false, volume: 1 });
        expect(notifications.length).toBeGreaterThan(0);
        expect(notifications.every((event) => event.source === "automatic")).toBe(true);
    });

    it.each([
        "user-first",
        "automatic-first",
    ])("同じbatchの自動更新と利用者編集を両方保存する（%s）", (order) => {
        const { result } = renderHook(() => useLocalStorage(KEY, defaults), {
            reactStrictMode: true,
        });
        const setter = result.current[1];
        const edit = () => setter((previous) => ({ ...previous, sound: false }));
        const normalize = () => setter((previous) => ({ ...previous, volume: 0.5 }), "automatic");
        act(() => {
            if (order === "user-first") {
                edit();
                normalize();
            } else {
                normalize();
                edit();
            }
        });
        expect(result.current[0]).toEqual({ sound: false, volume: 0.5 });
        expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual({
            sound: false,
            volume: 0.5,
        });
        expect(notifications).toEqual([{ key: KEY, source: "user" }]);
        expect(result.current[1]).toBe(setter);
    });

    it("保存済みの利用者編集を後続の自動更新に引き継がない", () => {
        const { result } = renderHook(() => useLocalStorage(KEY, defaults));
        act(() => result.current[1]({ sound: false, volume: 1 }));
        act(() => result.current[1]({ sound: false, volume: 0.5 }, "automatic"));
        expect(notifications).toEqual([
            { key: KEY, source: "user" },
            { key: KEY, source: "automatic" },
        ]);
    });

    it("変更しないsetter呼出しを後続の自動更新の編集通知にしない", () => {
        const { result } = renderHook(() => useLocalStorage(KEY, defaults));
        act(() => result.current[1]((previous) => previous));
        act(() => result.current[1]({ sound: false, volume: 1 }, "automatic"));
        expect(notifications).toEqual([{ key: KEY, source: "automatic" }]);
    });

    it("source省略の明示通知は利用者編集として画面に反映する", () => {
        const { result } = renderHook(() => useLocalStorage(KEY, defaults));
        act(() => {
            localStorage.setItem(KEY, JSON.stringify({ sound: false, volume: 1 }));
            dispatchLocalStorageSyncEvent(KEY);
        });
        expect(result.current[0]).toEqual({ sound: false, volume: 1 });
        expect(notifications[0]).toEqual({ key: KEY, source: "user" });
        expect(notifications.slice(1).every((event) => event.source === "automatic")).toBe(true);
    });
});
