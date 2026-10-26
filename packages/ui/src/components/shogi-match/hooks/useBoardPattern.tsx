import type { ReactElement, ReactNode } from "react";
import {
    type BoardPattern,
    BoardPatternProvider,
    DEFAULT_BOARD_PATTERN,
} from "../../board-appearance";
import { useLocalStorage } from "./useLocalStorage";

/** 対局・検討の表示設定の保存先。ログインしているとアカウントにも同期される。 */
export const DISPLAY_SETTINGS_STORAGE_KEY = "shogi-display-settings";

/** 表示設定に入れる前に、模様だけを保存していた場所。まだ表示設定に模様が無いときだけ読む。 */
const LEGACY_BOARD_PATTERN_KEY = "shogi-board-pattern";

// useLocalStorage は既定値の参照が変わると購読し直すので、毎回作らない。
const NO_STORED_SETTINGS: unknown = {};

const isBoardPattern = (value: unknown): value is BoardPattern =>
    value === "plain" || value === "checkered";

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

const readLegacyPattern = (): BoardPattern | undefined => {
    try {
        const legacy: unknown = JSON.parse(
            localStorage.getItem(LEGACY_BOARD_PATTERN_KEY) ?? "null",
        );
        return isBoardPattern(legacy) ? legacy : undefined;
    } catch {
        return undefined;
    }
};

/** 書く直前の保存内容。同じキーを読み書きするほかの画面（対局・研究ノート）の変更を消さないよう、手元の値ではなくこれに足す。 */
const readStoredSettings = (fallback: unknown): Record<string, unknown> => {
    try {
        const raw = localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY);
        return asRecord(raw === null ? fallback : JSON.parse(raw));
    } catch {
        return asRecord(fallback);
    }
};

/**
 * 盤の模様の設定。表示設定と同じ保存先の `boardPattern` に置く（アカウントに同期されるように）。
 * 観戦の表示設定は別の保存先だが、模様はどの画面の盤にも同じものを効かせるので、常にこちらを読み書きする。
 */
export function useBoardPattern(): readonly [BoardPattern, (pattern: BoardPattern) => void] {
    const [stored, setStored] = useLocalStorage<unknown>(
        DISPLAY_SETTINGS_STORAGE_KEY,
        NO_STORED_SETTINGS,
    );
    const storedPattern = asRecord(stored).boardPattern;
    const pattern: BoardPattern = isBoardPattern(storedPattern)
        ? storedPattern
        : (readLegacyPattern() ?? DEFAULT_BOARD_PATTERN);
    return [
        pattern,
        (next) =>
            setStored((prev: unknown) => ({ ...readStoredSettings(prev), boardPattern: next })),
    ];
}

/** アプリの root に置き、保存している模様を画面の中のすべての盤に渡す。 */
export function StoredBoardPatternProvider({ children }: { children: ReactNode }): ReactElement {
    const [pattern] = useBoardPattern();
    return <BoardPatternProvider pattern={pattern}>{children}</BoardPatternProvider>;
}
