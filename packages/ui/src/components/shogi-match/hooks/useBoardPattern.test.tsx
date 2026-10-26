import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DISPLAY_SETTINGS_STORAGE_KEY, useBoardPattern } from "./useBoardPattern";
import { useLocalStorage } from "./useLocalStorage";

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

    it("表示設定に null などオブジェクトでない値が入っていても、無地として扱う", () => {
        localStorage.setItem(DISPLAY_SETTINGS_STORAGE_KEY, "null");
        const { result } = renderHook(() => useBoardPattern());
        expect(result.current[0]).toBe("plain");
        act(() => result.current[1]("checkered"));
        expect(JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY) ?? "null")).toEqual({
            boardPattern: "checkered",
        });
    });

    it("表示設定に模様が無ければ、以前の保存先（模様だけのキー）の値を使う", () => {
        localStorage.setItem("shogi-board-pattern", JSON.stringify("checkered"));
        const { result } = renderHook(() => useBoardPattern());
        expect(result.current[0]).toBe("checkered");
    });

    it("同じ保存先を使う対局画面の表示設定と、互いの変更を消さない", () => {
        const { result } = renderHook(() => ({
            board: useBoardPattern(),
            display: useLocalStorage<Record<string, unknown>>(DISPLAY_SETTINGS_STORAGE_KEY, {}),
        }));
        act(() => result.current.board[1]("checkered"));
        act(() => result.current.display[1]((prev) => ({ ...prev, showBoardLabels: false })));
        act(() => result.current.board[1]("plain"));
        expect(JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY) ?? "{}")).toEqual({
            boardPattern: "plain",
            showBoardLabels: false,
        });
    });
});
