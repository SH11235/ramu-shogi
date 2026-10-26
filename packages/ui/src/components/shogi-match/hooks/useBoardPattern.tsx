import type { ReactElement, ReactNode } from "react";
import {
    type BoardPattern,
    BoardPatternProvider,
    DEFAULT_BOARD_PATTERN,
} from "../../board-appearance";
import { useLocalStorage } from "./useLocalStorage";

/** 対局・検討の表示設定の保存先。ログインしているとアカウントにも同期される。 */
export const DISPLAY_SETTINGS_STORAGE_KEY = "shogi-display-settings";

// useLocalStorage は既定値の参照が変わると購読し直すので、毎回作らない。
const NO_STORED_SETTINGS: { boardPattern?: unknown } = {};

/**
 * 盤の模様の設定。表示設定と同じ保存先の `boardPattern` に置く（アカウントに同期されるように）。
 * 観戦の表示設定は別の保存先だが、模様はどの画面の盤にも同じものを効かせるので、常にこちらを読み書きする。
 */
export function useBoardPattern(): readonly [BoardPattern, (pattern: BoardPattern) => void] {
    const [stored, setStored] = useLocalStorage<{ boardPattern?: unknown }>(
        DISPLAY_SETTINGS_STORAGE_KEY,
        NO_STORED_SETTINGS,
    );
    const pattern: BoardPattern =
        stored.boardPattern === "checkered" || stored.boardPattern === "plain"
            ? stored.boardPattern
            : DEFAULT_BOARD_PATTERN;
    return [pattern, (next) => setStored((prev) => ({ ...prev, boardPattern: next }))];
}

/** アプリの root に置き、保存している模様を画面の中のすべての盤に渡す。 */
export function StoredBoardPatternProvider({ children }: { children: ReactNode }): ReactElement {
    const [pattern] = useBoardPattern();
    return <BoardPatternProvider pattern={pattern}>{children}</BoardPatternProvider>;
}
