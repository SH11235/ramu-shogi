/**
 * shogi-match コンポーネントで使用する定数
 */

/** デフォルト秒読み時間（ミリ秒） */
export const DEFAULT_BYOYOMI_MS = 10_000;

/** ログ履歴の最大保持件数 */
export const DEFAULT_MAX_LOGS = 80;

/** ツールチップ表示遅延（ミリ秒） */
export const TOOLTIP_DELAY_DURATION_MS = 120;

/**
 * レイアウト用Tailwindクラス（CSS変数はクラスで設定）
 *
 * 棋譜の一覧の高さ（--kifu-panel-max-h）は、ウィンドウの高さから、一覧より上にあるもの（ページの
 * ヘッダー、タブ、評価値グラフ、棋譜の操作の行）と下の余白の分（約 430px）を引く。長い棋譜でも
 * ページ全体が縦にスクロールしないようにする。
 */
export const MATCH_LAYOUT_CLASSES =
    "flex flex-col gap-2 items-center py-2 [--kifu-panel-max-h:min(60vh,calc(100dvh-430px))] [--kifu-panel-branch-max-h:calc(var(--kifu-panel-max-h)-40px)] [--shogi-cell-size:44px]";

/** localStorage マイグレーション用の旧キー */
export const LEGACY_STORAGE_KEYS = {
    senteNnueId: "shogi:senteNnueId",
    goteNnueId: "shogi:goteNnueId",
    analysisNnueId: "shogi:analysisNnueId",
    matchNnueId: "shogi:matchNnueId",
} as const;
