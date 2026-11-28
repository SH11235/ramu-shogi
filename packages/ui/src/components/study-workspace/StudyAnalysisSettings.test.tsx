import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_SETTINGS } from "../shogi-match/types";
import { StudyAnalysisSettings } from "./StudyAnalysisSettings";
import { createTestStudy } from "./study-test-support";
import type { StudyAnalysisSettingsForm } from "./useStudyAnalysis";

const createForm = (
    overrides: Partial<StudyAnalysisSettingsForm> = {},
): StudyAnalysisSettingsForm => ({
    settings: { ...DEFAULT_ANALYSIS_SETTINGS, deepAnalysisThreads: 2 },
    onSettingsChange: vi.fn(),
    nnueSelection: { presetKey: "ramu", nnueId: null },
    onNnueSelectionChange: vi.fn(),
    presets: [],
    nnueList: [],
    isNnueListLoading: false,
    engines: [{ id: "wasm", label: "内蔵エンジン", kind: "internal" }],
    engineId: "wasm",
    maxParallel: null,
    maxThreads: 8,
    onEngineIdChange: vi.fn(),
    ...overrides,
});

const renderSettings = (
    props: {
        form?: StudyAnalysisSettingsForm;
        mateSupported?: boolean;
        deepReading?: boolean;
    } = {},
) =>
    render(
        <StudyAnalysisSettings
            open
            onOpenChange={vi.fn()}
            isMobile={false}
            doc={createTestStudy().doc}
            displayLayerId={null}
            onDisplayLayerChange={vi.fn()}
            form={props.form ?? createForm()}
            settingsLabel="RAMU・1 秒"
            canStart
            onStartFull={vi.fn()}
            mateSupported={props.mateSupported}
            deepReading={props.deepReading}
        />,
    );

describe("StudyAnalysisSettings", () => {
    it("詰み探索は、この局面の読みと同じスレッド数を使うと書き、使う AI が効かないと示す", () => {
        renderSettings({ mateSupported: true });
        const mate = screen.getByRole("region", { name: "詰み探索" });
        expect(within(mate).getByText("この局面の読みと同じ（2）")).toBeTruthy();
        expect(within(mate).getByText(/10 秒まで・最短手順は 2 分まで/)).toBeTruthy();
        expect(screen.getByRole("list", { name: "効く解析" }).textContent).toContain(
            "効かない: 詰み探索",
        );
    });

    it("詰み探索を使えないときは、詰み探索の段を出さない", () => {
        renderSettings({ mateSupported: false });
        expect(screen.queryByRole("region", { name: "詰み探索" })).toBeNull();
    });

    it("この局面を読んでいる間は、変えた値が次に読み始めるときから効くと知らせる", () => {
        renderSettings({ deepReading: true });
        const position = screen.getByRole("region", { name: "この局面の読み" });
        expect(within(position).getByText(/次に読み始めるときから使います/)).toBeTruthy();
    });

    it("スレッドを使えないブラウザでは、スレッド数を選ばせず理由を書く", () => {
        renderSettings({ form: createForm({ maxThreads: 1 }) });
        const position = screen.getByRole("region", { name: "この局面の読み" });
        const select = within(position).getByRole("combobox", { name: /スレッド数/ });
        expect((select as HTMLSelectElement).disabled).toBe(true);
        expect(within(position).getByText("このブラウザでは 1 スレッドで読みます。")).toBeTruthy();
    });

    it("全体の解析で使うスレッドの合計を、同時に解析する局面の数と掛けて書く", () => {
        const form = createForm({
            settings: { ...DEFAULT_ANALYSIS_SETTINGS, parallelWorkers: 2, batchAnalysisThreads: 3 },
        });
        renderSettings({ form });
        const full = screen.getByRole("region", { name: "全体の解析" });
        expect(
            within(full).getByText(
                /同時に 2 局面 × 3 スレッドで、多いときは合わせて 6 スレッドを使います/,
            ),
        ).toBeTruthy();
    });
});
