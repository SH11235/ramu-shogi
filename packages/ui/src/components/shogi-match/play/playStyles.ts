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

/**
 * 盤の上下の持ち駒の欄（`data-zone="hand-…"`。`PCBoardContent` / `MobileBoardSection` が描く）の見た目。
 * 盤を包む要素に付ける。
 * - 駒の大きさに合わせた高さを最初から確保する（駒を取ったときに、盤や操作が動かないように）。
 * - 空のときは破線の枠だけを見せる。駒があるときの枠は和の配色に寄せ、地は付けない。
 *
 * 持ち駒の欄の部品（`HandPiecesDisplay`）は、空のとき何も描かず、駒があるときは枠付きの div を 1 つ描く。
 * その作りに合わせた指定なので、部品の作りを変えるときはここも見直す。
 */
export const PLAY_HAND_ZONES =
    "[&_[data-zone^=hand-]]:min-h-[calc(var(--shogi-cell-size)*0.8+16px)] [&_[data-zone^=hand-]:empty]:rounded-md [&_[data-zone^=hand-]:empty]:border [&_[data-zone^=hand-]:empty]:border-dashed [&_[data-zone^=hand-]:empty]:border-wafuu-border [&_[data-zone^=hand-]>div]:border-wafuu-border [&_[data-zone^=hand-]>div]:bg-transparent";
