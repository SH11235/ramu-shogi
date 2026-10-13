/**
 * 対局画面（`screen="play"`）の部品で共通に使う見た目。
 *
 * サイトの和の配色（和紙・墨・朱・藍）に寄せる。主ボタンは朱、枠と文字は暖色の墨・和風の枠線、
 * 背景付きの欄（カード）は「脇に置く補足情報」（棋譜・ヒント）だけに使う。
 */

/** 主ボタン（その画面で 1 つだけ）。 */
export const PLAY_PRIMARY_BUTTON =
    "bg-wafuu-shu text-wafuu-shu-fg shadow-none hover:bg-wafuu-shu-light";

/** 副ボタン。 */
export const PLAY_OUTLINE_BUTTON =
    "min-h-10 border-wafuu-border bg-background text-wafuu-sumi hover:bg-wafuu-washi-warm hover:text-wafuu-sumi";

/** 補足情報の欄（棋譜・ヒント）。 */
export const PLAY_CARD = "rounded-xl border border-wafuu-border bg-wafuu-washi-warm p-4";

/** 画面の見出し（設定・局面編集・終局の結果）。 */
export const PLAY_HEADING = "font-display text-2xl font-semibold text-wafuu-sumi";

/** 文中のリンク。 */
export const PLAY_TEXT_LINK =
    "inline-flex min-h-10 items-center rounded-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0";
