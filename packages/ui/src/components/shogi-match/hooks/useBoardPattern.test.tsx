import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DISPLAY_SETTINGS_STORAGE_KEY, useBoardPattern } from "./useBoardPattern";

describe("useBoardPattern", () => {
    afterEach(() => localStorage.clear());

    it("保存が無ければ無地", () => {
        const { result } = renderHook(() => useBoardPattern());
        expect(result.current[0]).toBe("plain");
    });

    it("表示設定のほかの項目を消さずに、模様だけを書き換える", () => {
        localStorage.setItem(
            DISPLAY_SETTINGS_STORAGE_KEY,
            JSON.stringify({ showBoardLabels: false }),
        );
        const { result } = renderHook(() => useBoardPattern());
        act(() => result.current[1]("checkered"));
        expect(result.current[0]).toBe("checkered");
        expect(JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY) ?? "{}")).toEqual({
            showBoardLabels: false,
            boardPattern: "checkered",
        });
    });

    it("知らない値が保存されていれば無地として扱う", () => {
        localStorage.setItem(
            DISPLAY_SETTINGS_STORAGE_KEY,
            JSON.stringify({ boardPattern: "wood" }),
        );
        const { result } = renderHook(() => useBoardPattern());
        expect(result.current[0]).toBe("plain");
    });
});
