import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MatchSettingsProvider } from "../contexts/MatchSettingsContext";
import type { ClockSettings } from "../hooks/useClockManager";
import type { EngineSearchLimits, SideSetting } from "../types";
import { DEFAULT_DISPLAY_SETTINGS, DEFAULT_PASS_RIGHTS_SETTINGS } from "../types";
import { SEARCH_NODES_MAX } from "../utils/searchLimits";
import { PlayAdvancedSettings } from "./PlayAdvancedSettings";

vi.mock("../contexts/MatchStateContext", () => ({
    useMatchState: () => ({ displaySettings: DEFAULT_DISPLAY_SETTINGS }),
}));

const HUMAN: SideSetting = { role: "human" };
const AI: SideSetting = { role: "engine", engineId: "wasm" };
const UNLIMITED = { mainMs: 0, byoyomiMs: 10_000, incrementMs: 0, enabled: false };
const AI_3S = { mainMs: 0, byoyomiMs: 3_000, incrementMs: 0, enabled: true };

/** 設定を持つだけの親。いまの読む量を `snapshot.limits` で読む。 */
function renderSettings({
    sides,
    limits = { sente: { kind: "clock" }, gote: { kind: "clock" } },
    locked = false,
}: {
    sides: { sente: SideSetting; gote: SideSetting };
    limits?: EngineSearchLimits;
    locked?: boolean;
}) {
    const snapshot = { limits };
    function Harness(): ReactElement {
        const [time, setTime] = useState<ClockSettings>({ sente: UNLIMITED, gote: AI_3S });
        const [current, setLimits] = useState(snapshot.limits);
        snapshot.limits = current;
        return (
            <MatchSettingsProvider
                sides={sides}
                onSidesChange={() => {}}
                timeSettings={time}
                onTimeSettingsChange={setTime}
                passRightsSettings={DEFAULT_PASS_RIGHTS_SETTINGS}
                onPassRightsSettingsChange={() => {}}
                settingsLocked={locked}
                isDevMode={false}
                engineThreads={{ sente: 0, gote: 0 }}
                onEngineThreadsChange={() => {}}
                engineSearchLimits={current}
                onEngineSearchLimitsChange={setLimits}
                senteNnueSelection={{ presetKey: null, nnueId: null }}
                onSenteNnueSelectionChange={() => {}}
                goteNnueSelection={{ presetKey: null, nnueId: null }}
                onGoteNnueSelectionChange={() => {}}
                nnueList={[]}
                presets={[]}
                internalEngineId="wasm"
                engineOptions={[
                    {
                        id: "wasm",
                        label: "内蔵エンジン",
                        kind: "internal",
                        createClient: () => {
                            throw new Error("テストではエンジンを作らない");
                        },
                    },
                ]}
                onOpenNnueManager={() => {}}
                onOpenDisplaySettings={() => {}}
                onOpenPassRightsSettings={() => {}}
            >
                <PlayAdvancedSettings onDisplaySettingsChange={() => {}} />
            </MatchSettingsProvider>
        );
    }
    render(<Harness />);
    return snapshot;
}

const readingSelects = () => screen.queryAllByRole("combobox", { name: "読み方" });

describe("PlayAdvancedSettings（読む量）", () => {
    it("読み方は AI の側にだけ出し、ノード数にすると秒の欄の代わりに数の欄を出す", () => {
        const snapshot = renderSettings({ sides: { sente: HUMAN, gote: AI } });
        expect(readingSelects()).toHaveLength(1);
        expect(screen.getAllByRole("spinbutton", { name: /持ち時間/ })).toHaveLength(2);

        fireEvent.change(readingSelects()[0], { target: { value: "nodes" } });
        expect(snapshot.limits.gote).toEqual({ kind: "nodes", nodes: 1_000_000 });
        expect(snapshot.limits.sente).toEqual({ kind: "clock" });
        // 人の側の秒の欄は残り、AI の側だけ数の欄に替わる
        expect(screen.getAllByRole("spinbutton", { name: /持ち時間/ })).toHaveLength(1);
        expect(screen.getByRole("textbox", { name: /ノード数/ })).toHaveProperty(
            "value",
            "1000000",
        );
    });

    it("全角数字・桁区切りを受け、範囲外は保存せずに理由を出す", () => {
        const snapshot = renderSettings({
            sides: { sente: AI, gote: AI },
            limits: { sente: { kind: "nodes", nodes: 50_000 }, gote: { kind: "clock" } },
        });
        const input = screen.getByRole("textbox", { name: /ノード数/ });
        fireEvent.change(input, { target: { value: "２００，０００" } });
        expect(snapshot.limits.sente).toEqual({ kind: "nodes", nodes: 200_000 });
        expect(screen.getByText("毎手 20万局面まで読む（時計は使わない）")).toBeTruthy();

        fireEvent.change(input, { target: { value: "0" } });
        expect(screen.getByRole("alert").textContent).toBe("1 以上の整数で入れてください");
        fireEvent.change(input, { target: { value: String(SEARCH_NODES_MAX + 1) } });
        expect(screen.getByRole("alert")).toBeTruthy();
        expect(snapshot.limits.sente).toEqual({ kind: "nodes", nodes: 200_000 });
        // 欄を離れると、保存してある数に戻る
        fireEvent.blur(input);
        expect(input).toHaveProperty("value", "200000");
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("深さ・時計どおりに切り替えられ、時計どおりに戻すと秒の欄が戻る", () => {
        const snapshot = renderSettings({ sides: { sente: AI, gote: AI } });
        const [senteSelect] = readingSelects();
        fireEvent.change(senteSelect, { target: { value: "depth" } });
        expect(snapshot.limits.sente).toEqual({ kind: "depth", depth: 12 });
        fireEvent.change(screen.getByRole("textbox", { name: /深さ/ }), {
            target: { value: "61" },
        });
        expect(snapshot.limits.sente).toEqual({ kind: "depth", depth: 12 });

        fireEvent.change(senteSelect, { target: { value: "clock" } });
        expect(snapshot.limits.sente).toEqual({ kind: "clock" });
        expect(screen.getAllByRole("spinbutton", { name: /持ち時間/ })).toHaveLength(2);
    });

    it("対局中は読み方も数も変えさせない", () => {
        renderSettings({
            sides: { sente: AI, gote: HUMAN },
            limits: { sente: { kind: "depth", depth: 8 }, gote: { kind: "clock" } },
            locked: true,
        });
        expect(readingSelects()[0]).toHaveProperty("disabled", true);
        expect(screen.getByRole("textbox", { name: /深さ/ })).toHaveProperty("disabled", true);
    });
});
