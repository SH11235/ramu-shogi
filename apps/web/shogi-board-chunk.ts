/**
 * shogi-board chunk に入れるファイル（`packages/ui/src/components/` からの相対パス）。盤（ShogiBoard）と、
 * 盤が使う駒・座標・局面変換の小さな util。トップページの装飾の盤が、shogi-match chunk を読まずに使う。
 * ここのファイルが実行時に import してよいのは、この一覧のファイルと SHOGI_BOARD_ALLOWED_PACKAGES だけ
 * （shogi-board-chunk.test.ts で確かめる）。
 */
export const SHOGI_BOARD_MODULES = [
    "shogi-board.tsx",
    "shogi-match/utils/boardUtils.ts",
    "shogi-match/utils/constants.ts",
    "shogi-match/utils/coordinateFormat.ts",
    "shogi-match/utils/positionUtils.ts",
];

export const SHOGI_BOARD_ALLOWED_PACKAGES = ["@shogi/app-core", "@shogi/design-system", "react"];
