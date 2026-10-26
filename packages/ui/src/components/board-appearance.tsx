import { createContext, type ReactElement, type ReactNode, useContext } from "react";

/** 盤のマス目の模様。plain = 無地（格子の線だけ）、checkered = 市松（交互に濃淡） */
export type BoardPattern = "plain" | "checkered";

export const DEFAULT_BOARD_PATTERN: BoardPattern = "plain";

export const BOARD_PATTERN_OPTIONS: ReadonlyArray<{ value: BoardPattern; label: string }> = [
    { value: "plain", label: "無地" },
    { value: "checkered", label: "市松" },
];

const BoardPatternContext = createContext<BoardPattern>(DEFAULT_BOARD_PATTERN);

/**
 * 画面の中のすべての盤に、同じ模様を渡す。盤（ShogiBoard）は保存先を知らず、ここから受け取るだけにする
 * （トップページの装飾の盤も、shogi-match chunk を読まずに使えるように）。
 */
export function BoardPatternProvider({
    pattern,
    children,
}: {
    pattern: BoardPattern;
    children: ReactNode;
}): ReactElement {
    return <BoardPatternContext.Provider value={pattern}>{children}</BoardPatternContext.Provider>;
}

export function useBoardPatternContext(): BoardPattern {
    return useContext(BoardPatternContext);
}
