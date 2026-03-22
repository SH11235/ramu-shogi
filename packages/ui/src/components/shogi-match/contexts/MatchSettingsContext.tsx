/**
 * MatchSettingsContext
 *
 * 対局設定を管理するContext
 * - 先手/後手の設定（人間/AI、NNUE選択）
 * - 持ち時間設定
 * - パス権設定
 * - 表示設定ダイアログの制御
 *
 * 変更頻度: 低（対局開始前に設定、対局中はロック）
 */

import type { NnueMeta, NnueSelection, PresetWithStatus } from "@shogi/app-core";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { ClockSettings } from "../hooks/useClockManager";
import type { EngineOption, EngineThreadSettings, PassRightsSettings, SideSetting } from "../types";
import type { MatchSettingsContextValue } from "./types";

const MatchSettingsContext = createContext<MatchSettingsContextValue | null>(null);

interface MatchSettingsProviderProps {
    // 対局設定
    sides: { sente: SideSetting; gote: SideSetting };
    onSidesChange: (sides: { sente: SideSetting; gote: SideSetting }) => void;
    timeSettings: ClockSettings;
    onTimeSettingsChange: (settings: ClockSettings) => void;
    passRightsSettings: PassRightsSettings;
    onPassRightsSettingsChange: (settings: PassRightsSettings) => void;
    settingsLocked: boolean;
    isDevMode: boolean;
    engineThreads: EngineThreadSettings;
    onEngineThreadsChange: (threads: EngineThreadSettings) => void;

    // NNUE関連
    senteNnueSelection: NnueSelection;
    onSenteNnueSelectionChange: (selection: NnueSelection) => void;
    goteNnueSelection: NnueSelection;
    onGoteNnueSelectionChange: (selection: NnueSelection) => void;

    // NNUE一覧
    nnueList: NnueMeta[];
    presets: PresetWithStatus[];
    internalEngineId: string;

    // エンジン選択（複数エンジン対応、optional）
    engineOptions?: EngineOption[];

    // 解析エンジン選択（optional）
    analysisEngineId?: string;
    onAnalysisEngineIdChange?: (id: string) => void;

    // エンジン管理パネル制御（optional）
    onOpenEngineManager?: () => void;

    // 起動中エンジン設定パネル制御（optional）
    onOpenEngineSettings?: (side: "sente" | "gote" | "analysis") => void;

    // ダイアログ制御
    onOpenNnueManager: () => void;
    onOpenDisplaySettings: () => void;
    onOpenPassRightsSettings: () => void;

    children: ReactNode;
}

/**
 * 対局設定コンテキストを提供するProvider
 */
export function MatchSettingsProvider({
    sides,
    onSidesChange,
    timeSettings,
    onTimeSettingsChange,
    passRightsSettings,
    onPassRightsSettingsChange,
    settingsLocked,
    isDevMode,
    engineThreads,
    onEngineThreadsChange,
    senteNnueSelection,
    onSenteNnueSelectionChange,
    goteNnueSelection,
    onGoteNnueSelectionChange,
    nnueList,
    presets,
    internalEngineId,
    engineOptions,
    analysisEngineId,
    onAnalysisEngineIdChange,
    onOpenEngineManager,
    onOpenEngineSettings,
    onOpenNnueManager,
    onOpenDisplaySettings,
    onOpenPassRightsSettings,
    children,
}: MatchSettingsProviderProps): ReactNode {
    const value: MatchSettingsContextValue = {
        sides,
        onSidesChange,
        timeSettings,
        onTimeSettingsChange,
        passRightsSettings,
        onPassRightsSettingsChange,
        settingsLocked,
        isDevMode,
        engineThreads,
        onEngineThreadsChange,
        senteNnueSelection,
        onSenteNnueSelectionChange,
        goteNnueSelection,
        onGoteNnueSelectionChange,
        nnueList,
        presets,
        internalEngineId,
        engineOptions,
        analysisEngineId,
        onAnalysisEngineIdChange,
        onOpenEngineManager,
        onOpenEngineSettings,
        onOpenNnueManager,
        onOpenDisplaySettings,
        onOpenPassRightsSettings,
    };

    return <MatchSettingsContext.Provider value={value}>{children}</MatchSettingsContext.Provider>;
}

/**
 * 対局設定コンテキストを取得するフック
 *
 * Provider の外で使用した場合はエラーをスロー。
 */
export function useMatchSettings(): MatchSettingsContextValue {
    const ctx = useContext(MatchSettingsContext);
    if (!ctx) {
        throw new Error("useMatchSettings must be used within a MatchSettingsProvider");
    }
    return ctx;
}
