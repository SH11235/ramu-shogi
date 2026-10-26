/**
 * shogi-board chunk に入れるファイル（`packages/ui/src/components/` からの相対パス）。盤（ShogiBoard）と、
 * 盤が使う駒・座標・局面変換の小さな util。トップページの装飾の盤が、shogi-match chunk を読まずに使う。
 * ここのファイルが実行時に import してよいのは、この一覧のファイルと SHOGI_BOARD_ALLOWED_SHARED_MODULES、
 * SHOGI_BOARD_ALLOWED_PACKAGES だけ（shogi-board-chunk.test.ts で確かめる）。
 */
export const SHOGI_BOARD_MODULES = [
    "shogi-board.tsx",
    "shogi-match/hooks/useBoardPattern.ts",
    "shogi-match/utils/boardUtils.ts",
    "shogi-match/utils/constants.ts",
    "shogi-match/utils/coordinateFormat.ts",
    "shogi-match/utils/positionUtils.ts",
];

/**
 * shogi-board chunk の外にあるが、import してよいファイル。vite.config.ts で shogi-match より前に
 * 小さな専用 chunk へ分けていて、react のほかに何も読まない（shogi-match chunk を引き込まない）。
 */
export const SHOGI_BOARD_ALLOWED_SHARED_MODULES = ["shogi-match/hooks/useLocalStorage.ts"];

export const SHOGI_BOARD_ALLOWED_PACKAGES = ["@shogi/app-core", "@shogi/design-system", "react"];
