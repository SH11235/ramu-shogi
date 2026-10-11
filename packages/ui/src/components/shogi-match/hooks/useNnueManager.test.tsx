import { createDefaultNnueSelection } from "@shogi/app-core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// プリセット一覧は取得済みとして扱う（選択の自動修正が動く状態にする）。
vi.mock("../../../hooks/usePresetManager", () => ({
    usePresetManager: () => ({
        presets: [{ config: { presetKey: "ramu", displayName: "RAMU" } }],
        isLoading: false,
        hasFetchedPresets: true,
    }),
}));

const { useNnueManager } = await import("./useNnueManager");

const MATERIAL = { presetKey: null, nnueId: null };

const renderManager = () =>
    renderHook(() =>
        useNnueManager({
            defaultNnueSelection: createDefaultNnueSelection("ramu"),
            manifestUrl: "https://example.test/nnue/manifest.json",
            restartEngineForNnue: async () => {},
        }),
    );

describe("useNnueManager: 解析用の AI の選択", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("初めての訪問（保存済みの選択なし）でも、利用者が選んだ「簡易AI（駒得）」が既定へ戻らない", async () => {
        const { result } = renderManager();
        expect(result.current.analysisNnueSelection).toEqual({ presetKey: "ramu", nnueId: null });

        act(() => result.current.setAnalysisNnueSelection(MATERIAL));

        // 自動修正の効果が走っても、選んだまま。
        await waitFor(() => expect(result.current.analysisNnueSelection).toEqual(MATERIAL));
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(result.current.analysisNnueSelection).toEqual(MATERIAL);
        expect(JSON.parse(localStorage.getItem("shogi:analysisNnueSelection") ?? "null")).toEqual(
            MATERIAL,
        );
    });

    it("対局用の選択の扱いは変えていない（保存なしの駒得は、従来どおり既定の AI へ移る）", async () => {
        const { result } = renderManager();
        expect(result.current.analysisNnueSelection.presetKey).toBe("ramu");
        act(() => result.current.setSenteNnueSelection(MATERIAL));
        await waitFor(() => expect(result.current.senteNnueSelection.presetKey).toBe("ramu"));
    });
});
