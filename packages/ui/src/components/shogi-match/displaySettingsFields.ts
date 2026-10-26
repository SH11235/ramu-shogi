import type { DisplaySettings, SquareNotation } from "./types";

// 表示設定は対局の設定・PC の検討・スマホの設定シートの 3 か所に出る。項目の名前と選択肢はここだけで決め、
// 画面ごとに言い方がずれないようにする（どの項目を出すかと並べ方は、画面ごとに決める）。

export const SQUARE_NOTATION_LABEL = "マスの中の座標";

export const SQUARE_NOTATION_OPTIONS: ReadonlyArray<{ value: SquareNotation; label: string }> = [
    { value: "none", label: "なし" },
    { value: "sfen", label: "SFEN（5e）" },
    { value: "japanese", label: "日本式（５五）" },
];

export const BOARD_PATTERN_LABEL = "盤の模様";

/** チェックボックスで切り替える表示設定 */
export type DisplayToggleKey = {
    [K in keyof DisplaySettings]: DisplaySettings[K] extends boolean ? K : never;
}[keyof DisplaySettings];

export const DISPLAY_TOGGLE_LABELS: Readonly<Partial<Record<DisplayToggleKey, string>>> = {
    showBoardLabels: "盤の外に筋・段を表示",
    highlightLastMove: "直前の手を強調",
    showKifuEval: "棋譜に評価値を表示",
    showSearchInfo: "探索情報（NPS・深さ）を表示",
    enableWheelNavigation: "盤の上のホイールで棋譜を送る",
};

/** 項目の名前だけでは伝わらない動き（PC でマウスを乗せたときに出す） */
export const DISPLAY_TOGGLE_HINTS: Readonly<Partial<Record<DisplayToggleKey, string>>> = {
    enableWheelNavigation:
        "盤の上でマウスホイールを下に回すと棋譜を 1 手進め、上に回すと 1 手戻します。対局中は効きません。",
};

/** 表示設定のチェックボックスの見た目（3 か所でそろえる） */
export const DISPLAY_TOGGLE_CHECKBOX_CLASS = "h-4 w-4 accent-wafuu-shu";
