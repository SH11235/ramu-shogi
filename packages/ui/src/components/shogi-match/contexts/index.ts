/**
 * ShogiMatch Contexts
 *
 * Props drilling（合計124個のProps）を解消するためのContext群
 *
 * 変更頻度とアクセスパターンで4つに分割:
 * - MatchSettingsContext: 対局設定（変更頻度: 低）
 * - MatchStateContext: 対局進行状態（変更頻度: 高）
 * - NavigationContext: 棋譜ナビゲーション（変更頻度: 高）
 * - AnalysisContext: 分析状態（変更頻度: 中）
 */

// MatchSettingsContext
export {
    MatchSettingsProvider,
    useMatchSettings,
    useMatchSettingsOptional,
} from "./MatchSettingsContext";

// NavigationContext
export {
    NavigationProvider,
    useNavigation,
    useNavigationOptional,
} from "./NavigationContext";

// MatchStateContext
export {
    MatchStateProvider,
    useMatchState,
    useMatchStateOptional,
} from "./MatchStateContext";

// Types
export type {
    AnalysisContextValue,
    BatchAnalysisState,
    HandInfo,
    KifuViewMode,
    MatchSettingsContextValue,
    MatchStateContextValue,
    NavigationContextValue,
    NavigationHandlers,
    NavigationState,
    SelectionState,
} from "./types";
