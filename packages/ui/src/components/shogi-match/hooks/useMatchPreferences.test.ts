import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DISPLAY_SETTINGS_STORAGE_KEY } from "./useBoardPattern";
import { useMatchPreferences } from "./useMatchPreferences";

const options = (spectateMode: boolean) => ({
    screen: undefined,
    spectateMode,
    defaultSides: {
        sente: { role: "human" as const },
        gote: { role: "human" as const },
    },
    initialMainTimeMs: 0,
    initialByoyomiMs: 0,
    engineOptions: [],
});

describe("useMatchPreferences の候補手の矢印", () => {
    beforeEach(() => localStorage.clear());

    it("観戦の設定で変えた矢印の表示数は、研究ノートが読む通常の表示設定に書く", () => {
        localStorage.setItem(
            DISPLAY_SETTINGS_STORAGE_KEY,
            JSON.stringify({ showBoardLabels: false, candidateArrowCount: 2 }),
        );
        const { result } = renderHook(() => useMatchPreferences(options(true)));
        expect(result.current.displaySettings.candidateArrowCount).toBe(2);

        act(() => {
            result.current.setDisplaySettings({
                ...result.current.displaySettings,
                candidateArrowCount: 1,
            });
        });

        const shared = JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY) ?? "{}");
        expect(shared).toMatchObject({ showBoardLabels: false, candidateArrowCount: 1 });
        expect(result.current.displaySettings.candidateArrowCount).toBe(1);
    });

    it("保存してある矢印の値が壊れていれば既定値で読む", () => {
        localStorage.setItem(
            DISPLAY_SETTINGS_STORAGE_KEY,
            JSON.stringify({ showCandidateArrows: "yes", candidateArrowCount: 3 }),
        );
        const { result } = renderHook(() => useMatchPreferences(options(false)));
        expect(result.current.displaySettings.showCandidateArrows).toBe(true);
        expect(result.current.displaySettings.candidateArrowCount).toBe(2);
    });

    it("観戦で矢印以外の項目を変えても、研究ノート側の矢印の設定は書き戻さない", () => {
        localStorage.setItem(
            DISPLAY_SETTINGS_STORAGE_KEY,
            JSON.stringify({ showCandidateArrows: true }),
        );
        const { result } = renderHook(() => useMatchPreferences(options(true)));
        // 別のタブ（研究ノート）が矢印を切った。観戦の画面には古い値が残っている。
        localStorage.setItem(
            DISPLAY_SETTINGS_STORAGE_KEY,
            JSON.stringify({ showCandidateArrows: false }),
        );
        act(() => {
            result.current.setDisplaySettings({
                ...result.current.displaySettings,
                enableSound: false,
            });
        });
        expect(
            JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY) ?? "{}"),
        ).toMatchObject({ showCandidateArrows: false });
    });

    it("通常の表示設定が壊れていても、観戦から矢印の表示数を変えられる", () => {
        localStorage.setItem(DISPLAY_SETTINGS_STORAGE_KEY, "{broken");
        const { result } = renderHook(() => useMatchPreferences(options(true)));
        act(() => {
            result.current.setDisplaySettings({
                ...result.current.displaySettings,
                candidateArrowCount: 1,
            });
        });
        expect(result.current.displaySettings.candidateArrowCount).toBe(1);
    });

    it("観戦で「なし」を選んでも、別のタブで変えた表示数は残す", () => {
        localStorage.setItem(
            DISPLAY_SETTINGS_STORAGE_KEY,
            JSON.stringify({ showCandidateArrows: true, candidateArrowCount: 2 }),
        );
        const { result } = renderHook(() => useMatchPreferences(options(true)));
        localStorage.setItem(
            DISPLAY_SETTINGS_STORAGE_KEY,
            JSON.stringify({ showCandidateArrows: true, candidateArrowCount: 1 }),
        );
        act(() => {
            result.current.setDisplaySettings({
                ...result.current.displaySettings,
                showCandidateArrows: false,
            });
        });
        expect(
            JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY) ?? "{}"),
        ).toMatchObject({ showCandidateArrows: false, candidateArrowCount: 1 });
    });

    it("観戦で数を選んだら、別のタブの値によらず、選んだ数で矢印を入れる", () => {
        localStorage.setItem(
            DISPLAY_SETTINGS_STORAGE_KEY,
            JSON.stringify({ showCandidateArrows: false, candidateArrowCount: 2 }),
        );
        const { result } = renderHook(() => useMatchPreferences(options(true)));
        localStorage.setItem(
            DISPLAY_SETTINGS_STORAGE_KEY,
            JSON.stringify({ showCandidateArrows: false, candidateArrowCount: 1 }),
        );
        act(() => {
            result.current.setDisplaySettings({
                ...result.current.displaySettings,
                showCandidateArrows: true,
                candidateArrowCount: 2,
            });
        });
        expect(
            JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY) ?? "{}"),
        ).toMatchObject({ showCandidateArrows: true, candidateArrowCount: 2 });
    });
});
