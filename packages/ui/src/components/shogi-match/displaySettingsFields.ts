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

export const CANDIDATE_ARROW_LABEL = "矢印の表示数";
export const CANDIDATE_ARROW_HINT = "研究ノートの盤に、候補手を上から矢印で示します。";

export const CANDIDATE_ARROW_OPTIONS: ReadonlyArray<{ value: "0" | "1" | "2"; label: string }> = [
    { value: "0", label: "なし" },
    { value: "1", label: "1" },
    { value: "2", label: "2" },
];

type CandidateArrowSettings = Pick<DisplaySettings, "showCandidateArrows" | "candidateArrowCount">;

/** 保存してあった矢印の設定を、壊れた値・古いデータでも使える値にする。 */
export function normalizeCandidateArrowSettings(stored: unknown): CandidateArrowSettings {
    const value = (typeof stored === "object" && stored !== null ? stored : {}) as Partial<
        Record<keyof CandidateArrowSettings, unknown>
    >;
    return {
        showCandidateArrows:
            typeof value.showCandidateArrows === "boolean" ? value.showCandidateArrows : true,
        candidateArrowCount: value.candidateArrowCount === 1 ? 1 : 2,
    };
}

/** 「矢印の表示数」の選択肢の値。スイッチを切っていれば「なし」。 */
export function candidateArrowOption(settings: DisplaySettings): "0" | "1" | "2" {
    const { showCandidateArrows, candidateArrowCount } = normalizeCandidateArrowSettings(settings);
    return showCandidateArrows ? (String(candidateArrowCount) as "1" | "2") : "0";
}

/**
 * 「矢印の表示数」を選び直した設定。「なし」はスイッチを切るだけにし、数は残す
 * （研究ノートのスイッチで入れ直したときに前の数に戻すため）。
 */
export function withCandidateArrowOption(
    settings: DisplaySettings,
    option: string,
): DisplaySettings {
    if (option === "0") return { ...settings, showCandidateArrows: false };
    return {
        ...settings,
        showCandidateArrows: true,
        candidateArrowCount: option === "1" ? 1 : 2,
    };
}

/** 表示設定の欄にチェックボックスで出す項目（音や AI の読みは別の欄で扱う） */
export type DisplayToggleKey = Extract<
    keyof DisplaySettings,
    | "showBoardLabels"
    | "highlightLastMove"
    | "showKifuEval"
    | "showSearchInfo"
    | "enableWheelNavigation"
>;

export const DISPLAY_TOGGLE_LABELS: Readonly<Record<DisplayToggleKey, string>> = {
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
