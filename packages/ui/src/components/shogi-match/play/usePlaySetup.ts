/**
 * 対局画面（`screen="play"`）の「かんたん設定」。
 *
 * 対局の設定は内部では「先手・後手それぞれの担当・評価関数・時間」で持っている。この画面では
 * 「自分の手番・相手・強さ・時間」の 4 つに絞って見せ、内部の設定へ書き戻す。
 * AI 同士・人同士のような組み合わせは、詳細設定（従来の設定欄）で作る。
 */

import type { NnueSelection, Player } from "@shogi/app-core";
import { NONE_NNUE_SELECTION } from "@shogi/app-core";
import { SKILL_LEVEL_MAX } from "@shogi/engine-client";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import type { ClockSettings } from "../hooks/useClockManager";
import type { SideSetting } from "../types";

/** 対局の組み合わせ。 */
export type PlayMatchKind = "vs-ai" | "humans" | "ai-vs-ai";

export interface OpponentOption {
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
    enabled: boolean;
}

/** AI の 1 手の考慮時間（秒読み）。 */
export const AI_TIME_CHOICES: TimeChoice[] = [
    { id: "1", label: "1秒", mainMs: 0, byoyomiMs: 1_000, enabled: true },
    { id: "3", label: "3秒", mainMs: 0, byoyomiMs: 3_000, enabled: true },
    { id: "10", label: "10秒", mainMs: 0, byoyomiMs: 10_000, enabled: true },
    { id: "30", label: "30秒", mainMs: 0, byoyomiMs: 30_000, enabled: true },
];

/** 自分の持ち時間。 */
export const MY_TIME_CHOICES: TimeChoice[] = [
    { id: "none", label: "なし", mainMs: 0, byoyomiMs: 10_000, enabled: false },
    { id: "30", label: "1手30秒", mainMs: 0, byoyomiMs: 30_000, enabled: true },
    { id: "10+30", label: "10分＋30秒", mainMs: 600_000, byoyomiMs: 30_000, enabled: true },
];

const opposite = (side: Player): Player => (side === "sente" ? "gote" : "sente");

const matchesChoice = (setting: ClockSettings[Player], choice: TimeChoice): boolean =>
    choice.enabled
        ? setting.enabled &&
          setting.mainMs === choice.mainMs &&
          setting.byoyomiMs === choice.byoyomiMs
        : !setting.enabled;

export interface PlaySetup {
    kind: PlayMatchKind;
    /** 自分の手番（kind が "vs-ai" のときだけ意味を持つ） */
    mySide: Player;
    /** AI の側（"vs-ai" では相手、それ以外では後手を代表にする） */
    aiSide: Player;
    opponentOptions: OpponentOption[];
    opponentValue: string;
    opponent: OpponentOption | null;
    level: number;
    aiTimeId: string | null;
    myTimeId: string | null;
    locked: boolean;
    /** 自分の手番を決めて、人 対 AI の組み合わせにする（`opponentValue` を渡すと相手も同時に替える） */
    chooseSide: (side: Player, opponentValue?: string) => void;
    chooseOpponent: (value: string) => void;
    chooseLevel: (level: number) => void;
    chooseAiTime: (choice: TimeChoice) => void;
    chooseMyTime: (choice: TimeChoice) => void;
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
    const opponentValue = externalEngines.some((engine) => engine.id === aiSetting.engineId)
        ? `ext:${aiSetting.engineId}`
        : aiSelection.presetKey
          ? `preset:${aiSelection.presetKey}`
          : aiSelection.nnueId
            ? `nnue:${aiSelection.nnueId}`
            : "material";
    const opponent = opponentOptions.find((option) => option.value === opponentValue) ?? null;

    const aiClock = timeSettings[aiSide];
    const myClock = timeSettings[mySide];
    const aiTimeId = AI_TIME_CHOICES.find((choice) => matchesChoice(aiClock, choice))?.id ?? null;
    const myTimeId = MY_TIME_CHOICES.find((choice) => matchesChoice(myClock, choice))?.id ?? null;

    /** 相手の種類（選択欄の値）から、AI の側に入れる設定と評価関数を作る。 */
    const resolveOpponent = (
        value: string,
    ): { setting: SideSetting; selection: NnueSelection | null } | null => {
        if (value === "material") {
            return {
                setting: {
                    role: "engine",
                    engineId: internalEngineId,
                    skillLevel: aiSetting.skillLevel,
                },
                selection: NONE_NNUE_SELECTION,
            };
        }
        if (value.startsWith("preset:")) {
            return {
                setting: {
                    role: "engine",
                    engineId: internalEngineId,
                    skillLevel: aiSetting.skillLevel,
                },
                selection: { presetKey: value.slice("preset:".length), nnueId: null },
            };
        }
        if (value.startsWith("nnue:")) {
            return {
                setting: {
                    role: "engine",
                    engineId: internalEngineId,
                    skillLevel: aiSetting.skillLevel,
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
     * 自分の手番を決めて、人 対 AI の組み合わせにする。`opponentValue` を渡すと、相手も同時に替える
     * （別々に替えると、あとの更新が前の更新を古い値で上書きする）。
     */
    const chooseSide = (side: Player, opponentValue?: string) => {
        const next = opponentValue === undefined ? null : resolveOpponent(opponentValue);
        if (kind === "vs-ai" && side === mySide && !next) return;
        const other = opposite(side);
        const nextSetting = next?.setting ?? aiSetting;
        const nextSelection = next ? next.selection : aiSelection;
        // いまの AI の設定（評価関数・強さ・考慮時間）は、そのまま相手の側へ持っていく。
        const humanClock = kind === "vs-ai" ? myClock : { ...MY_TIME_CHOICES[0] };
        const engineClock = aiClock.enabled ? aiClock : { ...AI_TIME_CHOICES[1] };
        if (nextSelection) setSelection(other, nextSelection);
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
                enabled: humanClock.enabled,
            },
            [other]: {
                mainMs: engineClock.mainMs,
                byoyomiMs: engineClock.byoyomiMs,
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

    const applyClock = (side: Player, choice: TimeChoice) => {
        onTimeSettingsChange({
            ...timeSettings,
            [side]: {
                mainMs: choice.mainMs,
                byoyomiMs: choice.byoyomiMs,
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
        aiTimeId,
        myTimeId,
        locked: settingsLocked,
        chooseSide,
        chooseOpponent,
        chooseLevel,
        chooseAiTime: (choice) => applyClock(aiSide, choice),
        chooseMyTime: (choice) => applyClock(mySide, choice),
    };
}
