import type { Player } from "@shogi/app-core";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ENGINE_THREADS_STORAGE_KEY } from "../constants";
import {
    AI_MATCH_TIME_CHOICES,
    AI_TIME_CHOICES,
    MY_TIME_CHOICES,
    matchesChoice,
} from "../play/usePlaySetup";
import type {
    AnalysisSettings,
    DisplaySettings,
    EngineOption,
    EngineSearchLimits,
    EngineThreadSettings,
    PassRightsSettings,
    SideSetting,
} from "../types";
import {
    DEFAULT_ANALYSIS_SETTINGS,
    DEFAULT_DISPLAY_SETTINGS,
    DEFAULT_PASS_RIGHTS_SETTINGS,
} from "../types";
import { DEFAULT_HINT_MULTI_PV, normalizeHintMultiPv } from "../utils/hintSettings";
import { isSamePassRightsSettings, normalizePassRightsSettings } from "../utils/passRightsSettings";
import { DEFAULT_ENGINE_SEARCH_LIMITS, normalizeEngineSearchLimits } from "../utils/searchLimits";
import { isSameTimeSettings, normalizeTimeSettings } from "../utils/timeSettings";
import { DISPLAY_SETTINGS_STORAGE_KEY } from "./useBoardPattern";
import type { ClockSettings } from "./useClockManager";
import { type UseLocalStorageReturn, useLocalStorage } from "./useLocalStorage";
import { useNormalizedSettings } from "./useNormalizedSettings";

const MATCH_SIDES_KEY = "shogi-match-sides";
const PLAY_SIDES_KEY = "shogi-play-sides";

type MatchSides = { sente: SideSetting; gote: SideSetting };

/**
 * 対局画面を初めて開いたとき（先後をまだ PLAY_SIDES_KEY に保存していない）の先後。
 * 共有のキーの先後は、ほかの画面の既定値（観戦の人 対 人）や、AI 同士の保存値のこともあるので、
 * 引き継ぐのは「人 対 AI」のときだけ。引き継がないときは `alignTime` を立て、時間設定を
 * 対局画面の選択肢にそろえる。
 */
const readFirstPlaySides = (
    defaults: MatchSides,
): { sides: MatchSides; alignTime: boolean } | null => {
    if (typeof window === "undefined") return null;
    try {
        if (localStorage.getItem(PLAY_SIDES_KEY) !== null) return null;
        const raw = localStorage.getItem(MATCH_SIDES_KEY);
        const legacy = raw === null ? null : (JSON.parse(raw) as Partial<MatchSides> | null);
        const roles = [legacy?.sente?.role, legacy?.gote?.role];
        if (legacy?.sente && legacy.gote && roles.includes("human") && roles.includes("engine")) {
            return { sides: { sente: legacy.sente, gote: legacy.gote }, alignTime: false };
        }
    } catch {
        // 読めない保存値は、引き継がずに既定値で始める。
    }
    return { sides: defaults, alignTime: true };
};

/**
 * 人の側は MY_TIME_CHOICES、AI の側は AI の選択肢のどれにも当たらない時計を既定値にする
 * （AI 同士の 1 手 10 秒が自分の持ち時間に残る、観戦の「時間なし」が AI の考慮時間に残る、を防ぐ）。
 */
const alignTimeToPlayChoices = (
    settings: ClockSettings,
    sides: MatchSides,
    defaultClockFor: (role: SideSetting["role"]) => ClockSettings[Player],
): ClockSettings => {
    const align = (side: Player) => {
        const role = sides[side].role;
        const choices =
            role === "human" ? MY_TIME_CHOICES : [...AI_TIME_CHOICES, ...AI_MATCH_TIME_CHOICES];
        return choices.some((choice) => matchesChoice(settings[side], choice))
            ? settings[side]
            : defaultClockFor(role);
    };
    return { sente: align("sente"), gote: align("gote") };
};

/** ライブ観戦用の表示設定 localStorage キー (対局用と分離してチート防止既定を汚さない)。 */
const SPECTATE_DISPLAY_SETTINGS_KEY = "rshogi-live-display-settings";
/** ライブ観戦の既定表示設定。棋譜評価値カラムを既定 ON にする。 */
const SPECTATE_DISPLAY_SETTINGS: DisplaySettings = {
    ...DEFAULT_DISPLAY_SETTINGS,
    showKifuEval: true,
};

const normalizeThreadCount = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value)
        ? Math.min(32, Math.max(0, Math.trunc(value)))
        : 0;

// 0 は自動。旧 UI で選べた 32 超の値や、先後共通の数値で保存していた旧形式が残っていても、
// 現在の選択肢 (先後ごとに 0〜32) に収める。
const normalizeEngineThreads = (stored: EngineThreadSettings | number): EngineThreadSettings => {
    if (typeof stored === "number") {
        const normalized = normalizeThreadCount(stored);
        return { sente: normalized, gote: normalized };
    }
    if (!stored || typeof stored !== "object") {
        return { sente: 0, gote: 0 };
    }
    return {
        sente: normalizeThreadCount(stored.sente),
        gote: normalizeThreadCount(stored.gote),
    };
};

type Setter<T> = UseLocalStorageReturn<T>[1];

interface UseMatchPreferencesOptions {
    screen: "play" | undefined;
    spectateMode: boolean | undefined;
    defaultSides: MatchSides;
    initialMainTimeMs: number;
    initialByoyomiMs: number;
    engineOptions: EngineOption[];
}

/** 対局・検討の画面で、ブラウザに保存して次に開いたときも引き継ぐ設定。 */
interface MatchPreferences {
    sides: MatchSides;
    /** 先後を保存する（エンジンの破棄などは呼び出し側で行う）。 */
    setSides: (sides: MatchSides) => void;
    timeSettings: ClockSettings;
    setTimeSettings: Setter<ClockSettings>;
    hintMultiPv: number;
    setHintMultiPv: Setter<number>;
    displaySettings: DisplaySettings;
    setDisplaySettings: Setter<DisplaySettings>;
    analysisSettings: AnalysisSettings;
    setAnalysisSettings: Setter<AnalysisSettings>;
    analysisEngineId: string;
    setAnalysisEngineId: Setter<string>;
    passRightsSettings: PassRightsSettings;
    setPassRightsSettings: Setter<PassRightsSettings>;
    engineThreads: EngineThreadSettings;
    setEngineThreads: (next: EngineThreadSettings) => void;
    engineSearchLimits: EngineSearchLimits;
    setEngineSearchLimits: Setter<EngineSearchLimits>;
}

/**
 * 対局・検討の画面の設定（先後・時間・表示・解析・パス権・スレッド数・読む量・ヒントの候補数）を
 * localStorage から読み書きする。キーの一部はアカウントにも同期される（apps/web の userSettingsSync）
 * ので、キー名は変えない。
 */
export function useMatchPreferences({
    screen,
    spectateMode,
    defaultSides,
    initialMainTimeMs,
    initialByoyomiMs,
    engineOptions,
}: UseMatchPreferencesOptions): MatchPreferences {
    // 観戦・公開棋譜の画面も ShogiMatch を人 対 人で開き、その既定値を保存する。対局画面は別のキーに
    // 持ち、その保存で「自分 対 AI」の既定値が上書きされないようにする。
    const [firstPlaySides] = useState(() =>
        screen === "play" ? readFirstPlaySides(defaultSides) : null,
    );
    const [sides, storeSides] = useLocalStorage<MatchSides>(
        screen === "play" ? PLAY_SIDES_KEY : MATCH_SIDES_KEY,
        firstPlaySides?.sides ?? defaultSides,
    );

    const defaultTimeSettings = {
        sente: {
            mainMs: initialMainTimeMs,
            byoyomiMs: initialByoyomiMs,
            incrementMs: 0,
            enabled: defaultSides.sente.role !== "human",
        },
        gote: {
            mainMs: initialMainTimeMs,
            byoyomiMs: initialByoyomiMs,
            incrementMs: 0,
            enabled: defaultSides.gote.role !== "human",
        },
    };
    const [timeSettings, storeTimeSettings] = useNormalizedSettings(
        "shogi-match-time-settings",
        defaultTimeSettings,
        normalizeTimeSettings,
        isSameTimeSettings,
    );
    // 初めて開いた対局画面では、利用者が秒を指定するまで、時間設定をいまの先後の選択肢にそろえ続ける。
    // 1 度だけでは足りない（ログイン中は、サーバーに保存した時間設定があとから届いて書き戻される）。
    const alignTimeRef = useRef(firstPlaySides?.alignTime === true);
    // 先後は時計より先に書き込まれる（usePlaySetup）。時計を書くときは、その先後で選択肢を判定する。
    const latestSidesRef = useRef(sides);
    const alignToPlayChoices = (settings: ClockSettings, currentSides: MatchSides) =>
        alignTimeToPlayChoices(settings, currentSides, (role) => ({
            mainMs: initialMainTimeMs,
            byoyomiMs: initialByoyomiMs,
            incrementMs: 0,
            enabled: role !== "human",
        }));
    const alignTimeForFirstPlay = useEffectEvent(
        (current: ClockSettings, currentSides: MatchSides) => {
            latestSidesRef.current = currentSides;
            if (!alignTimeRef.current) return;
            const aligned = alignToPlayChoices(current, currentSides);
            if (!isSameTimeSettings(aligned, current)) {
                storeTimeSettings(
                    (latest) => alignToPlayChoices(latest, currentSides),
                    "automatic",
                );
            }
        },
    );
    useEffect(() => {
        alignTimeForFirstPlay(timeSettings, sides);
    }, [timeSettings, sides]);
    // 先後や時間の選択肢を選んだときの書き込みは、そろえ続けても変わらない。止めるのは、その役割の
    // 選択肢に当たらない時計（詳細設定で指定した秒）を書いたときだけ。
    const setTimeSettings: Setter<ClockSettings> = (next) => {
        if (
            typeof next === "function" ||
            !isSameTimeSettings(alignToPlayChoices(next, latestSidesRef.current), next)
        ) {
            alignTimeRef.current = false;
        }
        storeTimeSettings(next);
    };
    const setSides = (next: MatchSides) => {
        latestSidesRef.current = next;
        storeSides(next);
    };

    const [storedHintMultiPv, setHintMultiPv] = useLocalStorage<number>(
        "shogi-play-hint-multipv",
        DEFAULT_HINT_MULTI_PV,
    );

    // ライブ観戦は表示設定を別名前空間で扱い、棋譜評価値カラムを既定 ON にする。
    // 対局用の設定 (チート防止で showKifuEval=OFF 既定) を汚さず、観戦側で明示
    // トグルした値は観戦用キーに永続化されて尊重される。
    const displaySettingsDefaults = spectateMode
        ? SPECTATE_DISPLAY_SETTINGS
        : DEFAULT_DISPLAY_SETTINGS;
    const [storedDisplaySettings, setDisplaySettings] = useLocalStorage<DisplaySettings>(
        spectateMode ? SPECTATE_DISPLAY_SETTINGS_KEY : DISPLAY_SETTINGS_STORAGE_KEY,
        displaySettingsDefaults,
    );

    // 古い localStorage データに後から足したフィールドが無くても、既定値で補う。
    const [storedAnalysisSettings, setAnalysisSettings] = useLocalStorage<AnalysisSettings>(
        "shogi-analysis-settings",
        DEFAULT_ANALYSIS_SETTINGS,
    );
    const [analysisEngineId, setAnalysisEngineId] = useLocalStorage<string>(
        "shogi-analysis-engine",
        engineOptions[0]?.id ?? "wasm",
    );
    useEffect(() => {
        if (engineOptions.some((option) => option.id === analysisEngineId)) {
            return;
        }
        setAnalysisEngineId(engineOptions[0]?.id ?? "wasm");
    }, [analysisEngineId, engineOptions, setAnalysisEngineId]);

    const [passRightsSettings, setPassRightsSettings] = useNormalizedSettings(
        "shogi-pass-rights-settings",
        DEFAULT_PASS_RIGHTS_SETTINGS,
        normalizePassRightsSettings,
        isSamePassRightsSettings,
    );

    const [storedEngineThreads, setStoredEngineThreads] = useLocalStorage<
        EngineThreadSettings | number
    >(ENGINE_THREADS_STORAGE_KEY, { sente: 0, gote: 0 });
    const setEngineThreads = (next: EngineThreadSettings) => {
        setStoredEngineThreads({
            sente: Math.max(0, Math.trunc(next.sente)),
            gote: Math.max(0, Math.trunc(next.gote)),
        });
    };

    const [storedEngineSearchLimits, setEngineSearchLimits] = useLocalStorage<EngineSearchLimits>(
        "shogi-match-engine-search-limits",
        DEFAULT_ENGINE_SEARCH_LIMITS,
    );

    return {
        sides,
        setSides,
        timeSettings,
        setTimeSettings,
        hintMultiPv: normalizeHintMultiPv(storedHintMultiPv),
        setHintMultiPv,
        displaySettings: { ...displaySettingsDefaults, ...storedDisplaySettings },
        setDisplaySettings,
        analysisSettings: { ...DEFAULT_ANALYSIS_SETTINGS, ...storedAnalysisSettings },
        setAnalysisSettings,
        analysisEngineId,
        setAnalysisEngineId,
        passRightsSettings,
        setPassRightsSettings,
        engineThreads: normalizeEngineThreads(storedEngineThreads),
        setEngineThreads,
        engineSearchLimits: normalizeEngineSearchLimits(storedEngineSearchLimits),
        setEngineSearchLimits,
    };
}
