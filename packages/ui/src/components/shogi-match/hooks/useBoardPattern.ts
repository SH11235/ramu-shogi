import { useLocalStorage } from "./useLocalStorage";

/** 盤のマス目の模様。checkered = 市松（交互に濃淡）、plain = 無地（格子の線だけ） */
export type BoardPattern = "checkered" | "plain";

const BOARD_PATTERN_KEY = "shogi-board-pattern";

export const BOARD_PATTERN_OPTIONS: ReadonlyArray<{ value: BoardPattern; label: string }> = [
    { value: "checkered", label: "市松" },
    { value: "plain", label: "無地" },
];

/**
 * 盤の模様の設定。対局・検討・研究ノート・観戦など、どの画面の盤にも同じ設定を効かせるため、
 * 画面ごとの表示設定とは別のキーに保存する。
 */
export function useBoardPattern(): readonly [BoardPattern, (pattern: BoardPattern) => void] {
    const [stored, setStored] = useLocalStorage<BoardPattern>(BOARD_PATTERN_KEY, "checkered");
    const pattern: BoardPattern = stored === "plain" ? "plain" : "checkered";
    return [pattern, (next) => setStored(next)];
}
