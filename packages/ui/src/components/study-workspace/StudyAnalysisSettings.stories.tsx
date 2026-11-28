import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { type AnalysisSettings, DEFAULT_ANALYSIS_SETTINGS } from "../shogi-match/types";
import { StudyAnalysisSettings } from "./StudyAnalysisSettings";
import { createTestStudy } from "./study-test-support";
import type { StudyAnalysisSettingsForm } from "./useStudyAnalysis";

// 解析の設定。値を押すと見本の中の値も変わる（保存はしない）。

const doc = createTestStudy().doc;

function Demo({
    isMobile = false,
    maxThreads = 8,
    mateSupported = true,
    deepReading = false,
    engines = [{ id: "wasm", label: "内蔵エンジン", kind: "internal" as const }],
}: {
    isMobile?: boolean;
    maxThreads?: number;
    mateSupported?: boolean;
    deepReading?: boolean;
    engines?: StudyAnalysisSettingsForm["engines"];
}) {
    const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_ANALYSIS_SETTINGS);
    const form: StudyAnalysisSettingsForm = {
        settings,
        onSettingsChange: setSettings,
        nnueSelection: { presetKey: null, nnueId: null },
        onNnueSelectionChange: fn(),
        presets: [],
        nnueList: [],
        isNnueListLoading: false,
        engines,
        engineId: engines[0].id,
        maxParallel: null,
        maxThreads,
        onEngineIdChange: fn(),
    };
    return (
        <StudyAnalysisSettings
            open
            onOpenChange={fn()}
            isMobile={isMobile}
            doc={doc}
            displayLayerId={null}
            onDisplayLayerChange={fn()}
            form={form}
            settingsLabel={`簡易AI（駒得）・${settings.batchAnalysisTimeMs / 1000} 秒`}
            canStart
            onStartFull={fn()}
            onOpenNnueLibrary={fn()}
            mateSupported={mateSupported}
            deepReading={deepReading}
        />
    );
}

const meta = {
    title: "研究ノート/解析の設定",
    component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PC: Story = {};

export const スマートフォン: Story = {
    args: { isMobile: true, maxThreads: 2 },
    globals: { viewport: { value: "phone", isRotated: false } },
};

export const この局面を読んでいる間: Story = { args: { deepReading: true } };

export const スレッドを使えないブラウザ: Story = { args: { maxThreads: 1 } };

export const 詰み探索の無いエンジン: Story = {
    args: {
        mateSupported: false,
        engines: [
            { id: "native", label: "内蔵エンジン", kind: "internal" },
            { id: "usi", label: "外部エンジン", kind: "external" },
        ],
    },
};
