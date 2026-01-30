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

// AnalysisContext
export {
    AnalysisProvider,
    useAnalysis,
} from "./AnalysisContext";
// MatchSettingsContext
export {
    MatchSettingsProvider,
    useMatchSettings,
} from "./MatchSettingsContext";

// MatchStateContext
export {
    MatchStateProvider,
    useMatchState,
} from "./MatchStateContext";
// NavigationContext
export {
    NavigationProvider,
    useNavigation,
} from "./NavigationContext";
// Types
