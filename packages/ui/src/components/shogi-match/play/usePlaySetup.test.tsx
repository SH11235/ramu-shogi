import type { NnueSelection, PresetWithStatus } from "@shogi/app-core";
import { NONE_NNUE_SELECTION } from "@shogi/app-core";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { MatchSettingsProvider } from "../contexts/MatchSettingsContext";
import type { ClockSettings } from "../hooks/useClockManager";
import type { EngineSearchLimits, EngineThreadSettings, SideSetting } from "../types";
import { DEFAULT_PASS_RIGHTS_SETTINGS } from "../types";
import {
    AI_MATCH_TIME_CHOICES,
    AI_TIME_CHOICES,
    MY_TIME_CHOICES,
    usePlaySetup,
} from "./usePlaySetup";

type Sides = { sente: SideSetting; gote: SideSetting };

const RAMU: NnueSelection = { presetKey: "ramu", nnueId: null };
const PRESETS = [
    {
        config: {
            presetKey: "ramu",
            displayName: "RAMU",
            description: "",
            url: "https://example.com/ramu",
            size: 119_000_000,
            sha256: "hash",
            license: "MIT",
            releasedAt: "2026-10-11",
        },
        status: "not-downloaded",
        localMetas: [],
    },
] as unknown as PresetWithStatus[];

interface Initial {
    sides: Sides;
    time: ClockSettings;
    sente?: NnueSelection;
    gote?: NnueSelection;
}

/** 設定を持つだけの親（対局画面の `ShogiMatch` の代わり）。いまの値を `snapshot` で読む。 */
function setupHarness(initial: Initial) {
    const snapshot: {
        sides: Sides;
        time: ClockSettings;
        sente: NnueSelection;
        gote: NnueSelection;
        threads: EngineThreadSettings;
        limits: EngineSearchLimits;
    } = {
        sides: initial.sides,
        time: initial.time,
        sente: initial.sente ?? RAMU,
        gote: initial.gote ?? RAMU,
        threads: { sente: 0, gote: 0 },
        limits: { sente: { kind: "clock" }, gote: { kind: "clock" } },
    };
    function Wrapper({ children }: { children: ReactNode }) {
        const [sides, setSides] = useState(snapshot.sides);
        const [time, setTime] = useState(snapshot.time);
        const [sente, setSente] = useState(snapshot.sente);
        const [gote, setGote] = useState(snapshot.gote);
        const [threads, setThreads] = useState(snapshot.threads);
        const [limits, setLimits] = useState(snapshot.limits);
        Object.assign(snapshot, { sides, time, sente, gote, threads, limits });
        return (
            <MatchSettingsProvider
                sides={sides}
                onSidesChange={setSides}
                timeSettings={time}
                onTimeSettingsChange={setTime}
                passRightsSettings={DEFAULT_PASS_RIGHTS_SETTINGS}
                onPassRightsSettingsChange={() => {}}
                settingsLocked={false}
                isDevMode={false}
                engineThreads={threads}
                onEngineThreadsChange={setThreads}
                engineSearchLimits={limits}
                onEngineSearchLimitsChange={setLimits}
                senteNnueSelection={sente}
                onSenteNnueSelectionChange={setSente}
                goteNnueSelection={gote}
                onGoteNnueSelectionChange={setGote}
                nnueList={[]}
                presets={PRESETS}
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
                {children}
            </MatchSettingsProvider>
        );
    }
    const hook = renderHook(() => usePlaySetup(), { wrapper: Wrapper });
    return { hook, snapshot };
}

const HUMAN: SideSetting = { role: "human" };
const AI_L5: SideSetting = { role: "engine", engineId: "wasm", skillLevel: { skillLevel: 5 } };
const UNLIMITED = { mainMs: 0, byoyomiMs: 10_000, incrementMs: 0, enabled: false };
const AI_3S = { mainMs: 0, byoyomiMs: 3_000, incrementMs: 0, enabled: true };

describe("usePlaySetup（対局画面のかんたん設定）", () => {
    it("人 対 AI の設定を、自分の手番・相手・強さ・時間として読む", () => {
        const { hook } = setupHarness({
            sides: { sente: HUMAN, gote: AI_L5 },
            time: { sente: UNLIMITED, gote: AI_3S },
        });
        expect(hook.result.current.kind).toBe("vs-ai");
        expect(hook.result.current.mySide).toBe("sente");
        expect(hook.result.current.opponentValue).toBe("preset:ramu");
        expect(hook.result.current.opponent?.downloadMb).toBe(119);
        expect(hook.result.current.level).toBe(5);
        expect(hook.result.current.aiTimeId).toBe("3");
        expect(hook.result.current.myTimeId).toBe("none");
    });

    it("後手を選ぶと、AI の評価関数・強さ・考慮時間が先手の側へ移る", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: HUMAN, gote: AI_L5 },
            time: { sente: UNLIMITED, gote: AI_3S },
            sente: NONE_NNUE_SELECTION,
            gote: RAMU,
        });
        act(() => hook.result.current.chooseSide("gote"));
        expect(snapshot.sides.gote.role).toBe("human");
        expect(snapshot.sides.sente).toEqual(AI_L5);
        expect(snapshot.sente).toEqual(RAMU);
        expect(snapshot.time.sente).toEqual(AI_3S);
        expect(snapshot.time.gote.enabled).toBe(false);
        expect(hook.result.current.mySide).toBe("gote");
        expect(hook.result.current.level).toBe(5);
    });

    it("手番と相手を同時に替えても、相手が元に戻らない（振り駒 + 簡易AI とすぐ指す）", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: HUMAN, gote: AI_L5 },
            time: { sente: UNLIMITED, gote: AI_3S },
        });
        act(() => hook.result.current.chooseSide("gote", "material", AI_TIME_CHOICES[0]));
        expect(snapshot.sides.sente.role).toBe("engine");
        expect(snapshot.sente).toEqual(NONE_NNUE_SELECTION);
        expect(snapshot.time.sente.byoyomiMs).toBe(1_000);
        expect(hook.result.current.opponentValue).toBe("material");
        expect(hook.result.current.aiTimeId).toBe("1");
    });

    it("同じ手番のまま相手だけ替えられる", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: HUMAN, gote: AI_L5 },
            time: { sente: UNLIMITED, gote: AI_3S },
        });
        act(() => hook.result.current.chooseSide("sente", "material"));
        expect(snapshot.sides.sente.role).toBe("human");
        expect(snapshot.gote).toEqual(NONE_NNUE_SELECTION);
        // 強さは引き継ぐ
        expect(snapshot.sides.gote.skillLevel).toEqual({ skillLevel: 5 });
    });

    it("AI 同士の設定から「自分が AI と指す」に戻せる", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: AI_L5, gote: AI_L5 },
            time: { sente: AI_3S, gote: AI_3S },
        });
        expect(hook.result.current.kind).toBe("ai-vs-ai");
        act(() => hook.result.current.chooseSide("sente"));
        expect(snapshot.sides.sente.role).toBe("human");
        expect(snapshot.sides.gote.role).toBe("engine");
        expect(snapshot.time.sente.enabled).toBe(false);
        expect(hook.result.current.kind).toBe("vs-ai");
    });

    it("人同士の設定から戻すと、相手は内蔵エンジンになり、AI に考慮時間が付く", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: HUMAN, gote: HUMAN },
            time: { sente: UNLIMITED, gote: UNLIMITED },
        });
        expect(hook.result.current.kind).toBe("humans");
        act(() => hook.result.current.chooseSide("sente"));
        expect(snapshot.sides.gote).toEqual({ role: "engine", engineId: "wasm" });
        expect(snapshot.time.gote.enabled).toBe(true);
    });

    it("強さ・AI の考慮時間・自分の持ち時間は、それぞれの側だけを書き換える", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: AI_L5, gote: HUMAN },
            time: { sente: AI_3S, gote: UNLIMITED },
        });
        act(() => hook.result.current.chooseLevel(12));
        expect(snapshot.sides.sente.skillLevel).toEqual({ skillLevel: 12 });
        expect(snapshot.sides.gote).toEqual(HUMAN);
        act(() => hook.result.current.chooseAiTime(AI_TIME_CHOICES[2]));
        expect(snapshot.time.sente.byoyomiMs).toBe(10_000);
        expect(snapshot.time.gote).toEqual(UNLIMITED);
        act(() => hook.result.current.chooseMyTime(MY_TIME_CHOICES[2]));
        expect(snapshot.time.gote).toEqual({
            mainMs: 600_000,
            byoyomiMs: 30_000,
            incrementMs: 0,
            enabled: true,
        });
        expect(snapshot.time.sente.byoyomiMs).toBe(10_000);
    });

    it("対局の組み合わせを AI 対 AI にすると、いまの相手の AI が両方の側に入る", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: HUMAN, gote: AI_L5 },
            time: { sente: UNLIMITED, gote: AI_3S },
            sente: NONE_NNUE_SELECTION,
            gote: RAMU,
        });
        act(() => hook.result.current.chooseKind("ai-vs-ai"));
        expect(snapshot.sides).toEqual({ sente: AI_L5, gote: AI_L5 });
        expect(snapshot.sente).toEqual(RAMU);
        expect(snapshot.time.sente).toEqual(AI_3S);
        expect(hook.result.current.kind).toBe("ai-vs-ai");
        expect(hook.result.current.sideAi.sente.timeId).toBe("3");
        expect(hook.result.current.sideAi.gote.timeId).toBe("3");
        // それぞれの側の AI を別々に替えられる
        act(() => hook.result.current.chooseSideAi("sente", "material"));
        act(() => hook.result.current.chooseSideLevel("gote", 3));
        expect(snapshot.sente).toEqual(NONE_NNUE_SELECTION);
        expect(snapshot.gote).toEqual(RAMU);
        expect(hook.result.current.sideAi.sente.value).toBe("material");
        expect(hook.result.current.sideAi.gote.level).toBe(3);
    });

    it("AI 対 AI の考慮時間は先後で別に決められ、加算（フィッシャー）も選べる", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: AI_L5, gote: AI_L5 },
            time: { sente: AI_3S, gote: AI_3S },
        });
        const fischer = AI_MATCH_TIME_CHOICES.find((choice) => choice.id === "1m+1");
        if (!fischer) throw new Error("1分 +1秒 の選択肢が無い");
        act(() => hook.result.current.chooseSideTime("sente", fischer));
        expect(snapshot.time.sente).toEqual({
            mainMs: 60_000,
            byoyomiMs: 0,
            incrementMs: 1_000,
            enabled: true,
        });
        expect(snapshot.time.gote).toEqual(AI_3S);
        expect(hook.result.current.sideAi.sente.timeId).toBe("1m+1");
        expect(hook.result.current.sideAi.gote.timeId).toBe("3");
    });

    it("AI の時間を自分と同じにしておくと、自分の時間を変えたときに AI もそろう", () => {
        const mine = { mainMs: 600_000, byoyomiMs: 30_000, incrementMs: 0, enabled: true };
        const { hook, snapshot } = setupHarness({
            sides: { sente: HUMAN, gote: AI_L5 },
            time: { sente: mine, gote: { ...mine } },
        });
        act(() => hook.result.current.chooseMyTime(MY_TIME_CHOICES[1]));
        expect(snapshot.time.sente).toEqual({
            mainMs: 0,
            byoyomiMs: 30_000,
            incrementMs: 0,
            enabled: true,
        });
        expect(snapshot.time.gote).toEqual(snapshot.time.sente);
        // 無制限は AI に当てられないので、AI はそのまま
        act(() => hook.result.current.chooseMyTime(MY_TIME_CHOICES[0]));
        expect(snapshot.time.sente.enabled).toBe(false);
        expect(snapshot.time.gote.enabled).toBe(true);
    });

    it("対局の組み合わせを人 対 人にすると、両者とも人・時間無制限になり、持ち時間は両者に当てる", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: HUMAN, gote: AI_L5 },
            time: { sente: UNLIMITED, gote: AI_3S },
        });
        act(() => hook.result.current.chooseKind("humans"));
        expect(snapshot.sides.sente.role).toBe("human");
        expect(snapshot.sides.gote.role).toBe("human");
        expect(snapshot.time.gote.enabled).toBe(false);
        expect(hook.result.current.bothTimeId).toBe("none");
        act(() => hook.result.current.chooseBothTime(MY_TIME_CHOICES[1]));
        expect(snapshot.time.sente).toEqual({
            mainMs: 0,
            byoyomiMs: 30_000,
            incrementMs: 0,
            enabled: true,
        });
        expect(snapshot.time.gote).toEqual({
            mainMs: 0,
            byoyomiMs: 30_000,
            incrementMs: 0,
            enabled: true,
        });
        // 自分 対 AI に戻すと、後手が内蔵エンジンになる
        act(() => hook.result.current.chooseKind("vs-ai"));
        expect(snapshot.sides.gote.role).toBe("engine");
        expect(hook.result.current.kind).toBe("vs-ai");
    });

    it("ノード数で読む AI は時間の選択肢に当たらず、時間を選び直すと時計どおりに戻る", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: HUMAN, gote: AI_L5 },
            time: { sente: UNLIMITED, gote: AI_3S },
        });
        act(() => hook.result.current.chooseAiSearchLimit({ kind: "nodes", nodes: 50_000 }));
        expect(snapshot.limits).toEqual({
            sente: { kind: "clock" },
            gote: { kind: "nodes", nodes: 50_000 },
        });
        expect(hook.result.current.aiTimeId).toBeNull();
        act(() => hook.result.current.chooseAiTime(AI_TIME_CHOICES[1]));
        expect(snapshot.limits.gote).toEqual({ kind: "clock" });
        expect(hook.result.current.aiTimeId).toBe(AI_TIME_CHOICES[1].id);
    });

    it("手番を入れ替えると、AI の読む量とスレッド数も新しい AI の側へ移る", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: HUMAN, gote: AI_L5 },
            time: { sente: UNLIMITED, gote: AI_3S },
        });
        act(() => hook.result.current.chooseAiThreads(2));
        act(() => hook.result.current.chooseAiSearchLimit({ kind: "depth", depth: 8 }));
        act(() => hook.result.current.chooseSide("gote"));
        expect(snapshot.sides.sente.role).toBe("engine");
        expect(snapshot.threads.sente).toBe(2);
        expect(snapshot.limits.sente).toEqual({ kind: "depth", depth: 8 });
        expect(hook.result.current.aiThreads).toBe(2);
    });

    it("人 対 人から自分 対 AI に戻すと、AI の読む量は時計どおりに戻る", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: HUMAN, gote: AI_L5 },
            time: { sente: UNLIMITED, gote: AI_3S },
        });
        act(() => hook.result.current.chooseAiSearchLimit({ kind: "nodes", nodes: 50_000 }));
        act(() => hook.result.current.chooseKind("humans"));
        act(() => hook.result.current.chooseKind("vs-ai"));
        expect(snapshot.limits.gote).toEqual({ kind: "clock" });
    });

    it("AI 対 AI ではスレッド数・読む量を先後で別に決める", () => {
        const { hook, snapshot } = setupHarness({
            sides: { sente: AI_L5, gote: AI_L5 },
            time: { sente: AI_3S, gote: AI_3S },
        });
        act(() => hook.result.current.chooseSideThreads("sente", 3));
        expect(snapshot.threads).toEqual({ sente: 3, gote: 0 });
        expect(hook.result.current.sideAi.sente.threads).toBe(3);
        act(() => hook.result.current.chooseSideSearchLimit("sente", { kind: "depth", depth: 5 }));
        expect(hook.result.current.sideAi.sente.timeId).toBeNull();
        expect(hook.result.current.sideAi.gote.searchLimit).toEqual({ kind: "clock" });
    });
});
