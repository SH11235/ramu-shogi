/**
 * 対局画面（`screen="play"`）の「かんたん設定」。
 *
 * 対局の設定は内部では「先手・後手それぞれの担当・評価関数・時間」で持っている。この画面では
 * 「対局の組み合わせ・自分の手番・相手・強さ・時間」に絞って見せ、内部の設定へ書き戻す。
 */

import type { NnueSelection, Player } from "@shogi/app-core";
import { NONE_NNUE_SELECTION } from "@shogi/app-core";
import { SKILL_LEVEL_MAX } from "@shogi/engine-client";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import type { ClockSettings } from "../hooks/useClockManager";
import type { EngineSearchLimit, SideSetting } from "../types";
import { isSameClock } from "../utils/timeSettings";

/** 対局の組み合わせ。 */
export type PlayMatchKind = "vs-ai" | "humans" | "ai-vs-ai";

interface OpponentOption {
    /** "preset:<key>" | "nnue:<id>" | "material" | "ext:<engineId>" */
    value: string;
    label: string;
    /** 初回にダウンロードが要るときの大きさ（MB）。要らなければ null */
    downloadMb: number | null;
    /** 強さ（レベル）を選べるか。外部エンジンは選べない */
    supportsLevel: boolean;
    /** 用途の短い案内（「軽量」「棋力重視」など）。無ければ null */
    description: string | null;
}

export interface TimeChoice {
    id: string;
    label: string;
    mainMs: number;
    byoyomiMs: number;
    incrementMs: number;
    enabled: boolean;
}

const perMove = (seconds: number): TimeChoice => ({
    id: String(seconds),
    label: `1手${seconds}秒`,
    mainMs: 0,
    byoyomiMs: seconds * 1000,
    incrementMs: 0,
    enabled: true,
});

/**
 * 自分と指す AI の考慮時間。1 手ごとの秒数にそろえる（返事の速さが毎手同じで、AI が時間切れで負けない）。
 * 持ち時間・加算は「指定」で決める。
 */
export const AI_TIME_CHOICES: TimeChoice[] = [perMove(1), perMove(3), perMove(10), perMove(30)];

/**
 * AI 同士の考慮時間。持ち時間の使い方も強さのうちなので、短い加算（フィッシャー）も選べるようにする。
 * 1 分 +1 秒は 1 手あたり平均 1〜2 秒で、「1手3秒」と同じくらいの長さで終わる。
 */
export const AI_MATCH_TIME_CHOICES: TimeChoice[] = [
    perMove(1),
    perMove(3),
    perMove(10),
    {
        id: "1m+1",
        label: "1分 +1秒",
        mainMs: 60_000,
        byoyomiMs: 0,
        incrementMs: 1_000,
        enabled: true,
    },
    {
        id: "3m+2",
        label: "3分 +2秒",
        mainMs: 180_000,
        byoyomiMs: 0,
        incrementMs: 2_000,
        enabled: true,
    },
];

/** 自分の持ち時間。 */
export const MY_TIME_CHOICES: TimeChoice[] = [
    { id: "none", label: "無制限", mainMs: 0, byoyomiMs: 10_000, incrementMs: 0, enabled: false },
    { id: "30", label: "秒読み30秒", mainMs: 0, byoyomiMs: 30_000, incrementMs: 0, enabled: true },
    {
        id: "10+30",
        label: "10分 秒読み30秒",
        mainMs: 600_000,
        byoyomiMs: 30_000,
        incrementMs: 0,
        enabled: true,
    },
];

const opposite = (side: Player): Player => (side === "sente" ? "gote" : "sente");

export const matchesChoice = (setting: ClockSettings[Player], choice: TimeChoice): boolean =>
    choice.enabled
        ? setting.enabled &&
          setting.mainMs === choice.mainMs &&
          setting.byoyomiMs === choice.byoyomiMs &&
          setting.incrementMs === choice.incrementMs
        : !setting.enabled;

/** 時計の設定を選択肢の形にする（「自分と同じ」や、選択肢に無い時間を選び直すのに使う）。 */
export const clockAsChoice = (
    id: string,
    label: string,
    clock: ClockSettings[Player],
): TimeChoice => ({
    id,
    label,
    mainMs: clock.mainMs,
    byoyomiMs: clock.byoyomiMs,
    incrementMs: clock.incrementMs,
    enabled: clock.enabled,
});

interface PlaySetup {
    kind: PlayMatchKind;
    /** 自分の手番（kind が "vs-ai" のときだけ意味を持つ） */
    mySide: Player;
    /** AI の側（"vs-ai" では相手、それ以外では後手を代表にする） */
    aiSide: Player;
    opponentOptions: OpponentOption[];
    opponentValue: string;
    opponent: OpponentOption | null;
    level: number;
    /** AI の読む量（時計どおり・ノード数・深さ） */
    aiSearchLimit: EngineSearchLimit;
    /** AI のスレッド数（0 は自動）。AI 対 AI で先後が違えば null */
    aiThreads: number | null;
    aiTimeId: string | null;
    myTimeId: string | null;
    /** いまの AI・自分の時間（選択肢に無い値を、そのまま見せる・直すのに使う） */
    aiClock: ClockSettings[Player];
    myClock: ClockSettings[Player];
    /** 先後それぞれの時間（人同士・AI 同士で、両者が同じかを見る） */
    clocks: ClockSettings;
    locked: boolean;
    /** 自分の手番を決めて、人 対 AI の組み合わせにする（`opponentValue` を渡すと相手も同時に替える） */
    chooseSide: (side: Player, opponentValue?: string, aiTime?: TimeChoice) => void;
    chooseOpponent: (value: string) => void;
    chooseLevel: (level: number) => void;
    chooseAiTime: (choice: TimeChoice) => void;
    /** AI の読む量をノード数・深さで決める（AI 対 AI では先後とも） */
    chooseAiSearchLimit: (limit: EngineSearchLimit) => void;
    /** AI のスレッド数（AI 対 AI では先後とも） */
    chooseAiThreads: (threads: number) => void;
    chooseMyTime: (choice: TimeChoice) => void;
    /** 人 対 人の持ち時間（両者に同じ決まりを当てる）。両者が同じでなければ null */
    bothTimeId: string | null;
    chooseBothTime: (choice: TimeChoice) => void;
    /** 対局の組み合わせを替える（自分 対 AI ／ 人 対 人 ／ AI 対 AI） */
    chooseKind: (kind: PlayMatchKind) => void;
    /** AI 対 AI のときの、それぞれの側の AI（選択欄の値）・強さ・考慮時間 */
    sideAi: Record<
        Player,
        {
            value: string;
            option: OpponentOption | null;
            level: number;
            clock: ClockSettings[Player];
            searchLimit: EngineSearchLimit;
            /** AI_MATCH_TIME_CHOICES のどれに当たるか。当たらなければ（ノード数・深さで読むときも）null */
            timeId: string | null;
        }
    >;
    chooseSideAi: (side: Player, value: string) => void;
    chooseSideLevel: (side: Player, level: number) => void;
    chooseSideTime: (side: Player, choice: TimeChoice) => void;
    chooseSideSearchLimit: (side: Player, limit: EngineSearchLimit) => void;
}

export function usePlaySetup(): PlaySetup {
    const {
        sides,
        onSidesChange,
        timeSettings,
        onTimeSettingsChange,
        settingsLocked,
        senteNnueSelection,
        onSenteNnueSelectionChange,
        goteNnueSelection,
        onGoteNnueSelectionChange,
        nnueList,
        presets,
        internalEngineId,
        engineOptions,
        engineThreads,
        onEngineThreadsChange,
        engineSearchLimits,
        onEngineSearchLimitsChange,
    } = useMatchSettings();

    const senteIsHuman = sides.sente.role === "human";
    const goteIsHuman = sides.gote.role === "human";
    const kind: PlayMatchKind =
        senteIsHuman && goteIsHuman ? "humans" : senteIsHuman || goteIsHuman ? "vs-ai" : "ai-vs-ai";
    const mySide: Player = goteIsHuman && !senteIsHuman ? "gote" : "sente";
    const aiSide: Player = kind === "vs-ai" ? opposite(mySide) : "gote";

    const selectionOf = (side: Player): NnueSelection =>
        side === "sente" ? senteNnueSelection : goteNnueSelection;
    const setSelection = (side: Player, selection: NnueSelection) => {
        if (side === "sente") onSenteNnueSelectionChange(selection);
        else onGoteNnueSelectionChange(selection);
    };

    const externalEngines = (engineOptions ?? []).filter((engine) => engine.kind === "external");
    const opponentOptions: OpponentOption[] = [
        ...presets.map((preset) => ({
            value: `preset:${preset.config.presetKey}`,
            label: preset.config.displayName,
            downloadMb:
                preset.status === "not-downloaded"
                    ? Math.round(
                          (preset.config.size + (preset.config.progressCoefficients?.size ?? 0)) /
                              1_000_000,
                      )
                    : null,
            supportsLevel: true,
            // 一覧では「RAMU ・ 棋力重視」のように、用途の短い案内を名前に添える。
            description: preset.config.usageLabel ?? null,
        })),
        ...nnueList
            .filter((nnue) => nnue.source !== "preset")
            .map((nnue) => ({
                value: `nnue:${nnue.id}`,
                label: nnue.displayName,
                downloadMb: null,
                supportsLevel: true,
                description: null,
            })),
        {
            value: "material",
            label: "簡易AI（駒得）",
            downloadMb: null,
            supportsLevel: true,
            description: "ダウンロード不要",
        },
        ...externalEngines.map((engine) => ({
            value: `ext:${engine.id}`,
            label: engine.label,
            downloadMb: null,
            supportsLevel: false,
            description: null,
        })),
    ];

    const aiSetting: SideSetting =
        sides[aiSide].role === "engine"
            ? sides[aiSide]
            : { role: "engine", engineId: internalEngineId };
    const aiSelection = selectionOf(aiSide);
    /** その側の AI を、選択欄の値で表す。 */
    const aiValueOf = (setting: SideSetting, selection: NnueSelection): string =>
        externalEngines.some((engine) => engine.id === setting.engineId)
            ? `ext:${setting.engineId}`
            : selection.presetKey
              ? `preset:${selection.presetKey}`
              : selection.nnueId
                ? `nnue:${selection.nnueId}`
                : "material";
    const opponentValue = aiValueOf(aiSetting, aiSelection);
    const opponent = opponentOptions.find((option) => option.value === opponentValue) ?? null;
    const sideAiOf = (side: Player) => {
        const value = aiValueOf(sides[side], selectionOf(side));
        return {
            value,
            option: opponentOptions.find((option) => option.value === value) ?? null,
            level: sides[side].skillLevel?.skillLevel ?? SKILL_LEVEL_MAX,
            clock: timeSettings[side],
            searchLimit: engineSearchLimits[side],
            timeId:
                engineSearchLimits[side].kind === "clock"
                    ? (AI_MATCH_TIME_CHOICES.find((choice) =>
                          matchesChoice(timeSettings[side], choice),
                      )?.id ?? null)
                    : null,
        };
    };

    const aiClock = timeSettings[aiSide];
    const myClock = timeSettings[mySide];
    const aiSearchLimit = engineSearchLimits[aiSide];
    const aiTimeId =
        aiSearchLimit.kind === "clock"
            ? (AI_TIME_CHOICES.find((choice) => matchesChoice(aiClock, choice))?.id ?? null)
            : null;
    /** AI の読む量・スレッド数を、先後の両方（AI 対 AI）か AI の側だけに当てる。 */
    const aiTargets: Player[] = kind === "ai-vs-ai" ? ["sente", "gote"] : [aiSide];
    const withSides = <T>(current: Record<Player, T>, targets: Player[], value: T) => ({
        ...current,
        ...Object.fromEntries(targets.map((side) => [side, value])),
    });
    const myTimeId = MY_TIME_CHOICES.find((choice) => matchesChoice(myClock, choice))?.id ?? null;

    /** 相手の種類（選択欄の値）から、AI の側に入れる設定と評価関数を作る。 */
    const resolveOpponent = (
        value: string,
        base: SideSetting = aiSetting,
    ): { setting: SideSetting; selection: NnueSelection | null } | null => {
        if (value === "material") {
            return {
                setting: {
                    role: "engine",
                    engineId: internalEngineId,
                    skillLevel: base.skillLevel,
                },
                selection: NONE_NNUE_SELECTION,
            };
        }
        if (value.startsWith("preset:")) {
            return {
                setting: {
                    role: "engine",
                    engineId: internalEngineId,
                    skillLevel: base.skillLevel,
                },
                selection: { presetKey: value.slice("preset:".length), nnueId: null },
            };
        }
        if (value.startsWith("nnue:")) {
            return {
                setting: {
                    role: "engine",
                    engineId: internalEngineId,
                    skillLevel: base.skillLevel,
                },
                selection: { presetKey: null, nnueId: value.slice("nnue:".length) },
            };
        }
        if (value.startsWith("ext:")) {
            return {
                setting: {
                    role: "engine",
                    engineId: value.slice("ext:".length),
                    skillLevel: undefined,
                },
                // 外部エンジンは内蔵 AI の評価関数を使わない（選択は変えない）
                selection: null,
            };
        }
        return null;
    };

    /**
     * 自分の手番を決めて、人 対 AI の組み合わせにする。`opponentValue`・`aiTime` を渡すと、相手と
     * AI の考慮時間も同時に替える（別々に替えると、あとの更新が前の更新を古い値で上書きする）。
     */
    const chooseSide = (side: Player, opponentValue?: string, aiTime?: TimeChoice) => {
        const next = opponentValue === undefined ? null : resolveOpponent(opponentValue);
        if (kind === "vs-ai" && side === mySide && !next) return;
        const other = opposite(side);
        const nextSetting = next?.setting ?? aiSetting;
        const nextSelection = next ? next.selection : aiSelection;
        // いまの AI の設定（評価関数・強さ・考慮時間）は、そのまま相手の側へ持っていく。
        const humanClock = kind === "vs-ai" ? myClock : { ...MY_TIME_CHOICES[0] };
        const engineClock = aiTime ?? (aiClock.enabled ? aiClock : { ...AI_TIME_CHOICES[1] });
        if (nextSelection) setSelection(other, nextSelection);
        onEngineSearchLimitsChange({
            ...engineSearchLimits,
            // 人 対 人から戻すときは時間を選び直すので、読む量も時計どおりに戻す。
            [other]: aiTime || kind === "humans" ? { kind: "clock" } : aiSearchLimit,
        });
        onEngineThreadsChange({ ...engineThreads, [other]: engineThreads[aiSide] });
        onSidesChange({
            ...sides,
            [side]: { role: "human", engineId: undefined, skillLevel: undefined },
            [other]: nextSetting,
        });
        onTimeSettingsChange({
            ...timeSettings,
            [side]: {
                mainMs: humanClock.mainMs,
                byoyomiMs: humanClock.byoyomiMs,
                incrementMs: humanClock.incrementMs,
                enabled: humanClock.enabled,
            },
            [other]: {
                mainMs: engineClock.mainMs,
                byoyomiMs: engineClock.byoyomiMs,
                incrementMs: engineClock.incrementMs,
                enabled: true,
            },
        });
    };

    const chooseOpponent = (value: string) => {
        const next = resolveOpponent(value);
        if (!next) return;
        if (next.selection) setSelection(aiSide, next.selection);
        onSidesChange({ ...sides, [aiSide]: next.setting });
    };

    const chooseLevel = (level: number) => {
        onSidesChange({
            ...sides,
            [aiSide]: { ...aiSetting, skillLevel: { skillLevel: level } },
        });
    };

    const chooseKind = (next: PlayMatchKind) => {
        if (next === kind) return;
        if (next === "vs-ai") {
            chooseSide(mySide);
            return;
        }
        if (next === "humans") {
            const clock = { ...MY_TIME_CHOICES[0] };
            onSidesChange({
                sente: { role: "human", engineId: undefined, skillLevel: undefined },
                gote: { role: "human", engineId: undefined, skillLevel: undefined },
            });
            const off = {
                mainMs: clock.mainMs,
                byoyomiMs: clock.byoyomiMs,
                incrementMs: clock.incrementMs,
                enabled: false,
            };
            onTimeSettingsChange({ sente: { ...off }, gote: { ...off } });
            return;
        }
        // AI 対 AI: いまの相手の AI（評価関数・強さ・考慮時間）を、両方の側に置く。
        const engineClock = aiClock.enabled ? aiClock : { ...AI_TIME_CHOICES[1] };
        const clock = {
            mainMs: engineClock.mainMs,
            byoyomiMs: engineClock.byoyomiMs,
            incrementMs: engineClock.incrementMs,
            enabled: true,
        };
        setSelection("sente", aiSelection);
        setSelection("gote", aiSelection);
        onEngineSearchLimitsChange({ sente: aiSearchLimit, gote: aiSearchLimit });
        onEngineThreadsChange({ sente: engineThreads[aiSide], gote: engineThreads[aiSide] });
        onSidesChange({ sente: aiSetting, gote: aiSetting });
        onTimeSettingsChange({ sente: { ...clock }, gote: { ...clock } });
    };

    const chooseSideAi = (side: Player, value: string) => {
        const base: SideSetting =
            sides[side].role === "engine"
                ? sides[side]
                : { role: "engine", engineId: internalEngineId };
        const next = resolveOpponent(value, base);
        if (!next) return;
        if (next.selection) setSelection(side, next.selection);
        onSidesChange({ ...sides, [side]: next.setting });
    };

    const chooseSideLevel = (side: Player, level: number) => {
        onSidesChange({
            ...sides,
            [side]: { ...sides[side], skillLevel: { skillLevel: level } },
        });
    };

    const resetToClockLimit = (targets: Player[]) => {
        if (targets.every((side) => engineSearchLimits[side].kind === "clock")) return;
        onEngineSearchLimitsChange(withSides(engineSearchLimits, targets, { kind: "clock" }));
    };

    const applyClock = (side: Player, choice: TimeChoice) => {
        onTimeSettingsChange({
            ...timeSettings,
            [side]: {
                mainMs: choice.mainMs,
                byoyomiMs: choice.byoyomiMs,
                incrementMs: choice.incrementMs,
                enabled: choice.enabled,
            },
        });
    };

    return {
        kind,
        mySide,
        aiSide,
        opponentOptions,
        opponentValue,
        opponent,
        level: aiSetting.skillLevel?.skillLevel ?? SKILL_LEVEL_MAX,
        aiSearchLimit,
        aiThreads:
            kind === "ai-vs-ai" && engineThreads.sente !== engineThreads.gote
                ? null
                : engineThreads[aiSide],
        aiTimeId,
        myTimeId,
        aiClock,
        myClock,
        clocks: timeSettings,
        locked: settingsLocked,
        chooseSide,
        chooseOpponent,
        chooseLevel,
        chooseAiTime: (choice) => {
            resetToClockLimit([aiSide]);
            applyClock(aiSide, choice);
        },
        chooseAiSearchLimit: (limit) =>
            onEngineSearchLimitsChange(withSides(engineSearchLimits, aiTargets, limit)),
        chooseAiThreads: (threads) =>
            onEngineThreadsChange(withSides(engineThreads, aiTargets, threads)),
        chooseMyTime: (choice) => {
            // AI の時間が自分と同じ（選択欄に「自分と同じ」と出ている）なら、自分の時間を変えたときに AI もそろえる。
            // 無制限は AI に当てられないので、そのときは AI を動かさない。
            const followsMine =
                kind === "vs-ai" &&
                choice.enabled &&
                myClock.enabled &&
                isSameClock(aiClock, myClock);
            if (!followsMine) {
                applyClock(mySide, choice);
                return;
            }
            const clock = {
                mainMs: choice.mainMs,
                byoyomiMs: choice.byoyomiMs,
                incrementMs: choice.incrementMs,
                enabled: true,
            };
            onTimeSettingsChange({ ...timeSettings, [mySide]: clock, [aiSide]: { ...clock } });
        },
        bothTimeId:
            MY_TIME_CHOICES.find(
                (choice) =>
                    matchesChoice(timeSettings.sente, choice) &&
                    matchesChoice(timeSettings.gote, choice),
            )?.id ?? null,
        chooseBothTime: (choice) => {
            const clock = {
                mainMs: choice.mainMs,
                byoyomiMs: choice.byoyomiMs,
                incrementMs: choice.incrementMs,
                enabled: choice.enabled,
            };
            onTimeSettingsChange({ sente: { ...clock }, gote: { ...clock } });
        },
        chooseKind,
        sideAi: { sente: sideAiOf("sente"), gote: sideAiOf("gote") },
        chooseSideAi,
        chooseSideLevel,
        // AI は時間を決めずには指せないので、常に時間制限ありにする。
        chooseSideTime: (side, choice) => {
            resetToClockLimit([side]);
            applyClock(side, { ...choice, enabled: true });
        },
        chooseSideSearchLimit: (side, limit) =>
            onEngineSearchLimitsChange({ ...engineSearchLimits, [side]: limit }),
    };
}
