/**
 * MatchSettingsContext 型定義
 *
 * 対局設定コンテキストの型を定義
 */

import type { NnueMeta, NnueSelection, PresetWithStatus } from "@shogi/app-core";
import type { ClockSettings } from "../hooks/useClockManager";
import type { EngineOption, EngineThreadSettings, PassRightsSettings, SideSetting } from "../types";

/**
 * 対局設定コンテキスト値
 *
 * 変更頻度: 低（対局開始前に設定、対局中はロック）
 *
 * 責務:
 * - 対局者設定（先手/後手の人間/エンジン）
 * - 時間設定（持ち時間、秒読み等）
 * - パス権設定
 * - NNUE評価関数の選択
 */
export interface MatchSettingsContextValue {
    // 対局設定
    sides: { sente: SideSetting; gote: SideSetting };
    onSidesChange: (sides: { sente: SideSetting; gote: SideSetting }) => void;
    timeSettings: ClockSettings;
    onTimeSettingsChange: (settings: ClockSettings) => void;
    passRightsSettings: PassRightsSettings;
    onPassRightsSettingsChange: (settings: PassRightsSettings) => void;
    settingsLocked: boolean;
    /** 開発者モード */
    isDevMode: boolean;
    /** 対局用スレッド数（0=自動） */
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

    // エンジン選択（複数エンジン対応）
    engineOptions?: EngineOption[];

    // 解析エンジン選択
    analysisEngineId?: string;
    onAnalysisEngineIdChange?: (id: string) => void;

    // エンジン管理パネル制御
    onOpenEngineManager?: () => void;

    // 起動中エンジン設定パネル制御
    onOpenEngineSettings?: (side: "sente" | "gote" | "analysis") => void;

    // ダイアログ制御
    onOpenNnueManager: () => void;
    onOpenDisplaySettings: () => void;
    onOpenPassRightsSettings: () => void;
}
