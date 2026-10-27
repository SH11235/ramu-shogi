import type { PositionState } from "@shogi/app-core";
import type { SideSetting } from "../types";
import type { KifMove } from "./kifFormat";

/**
 * 読み筋のウィンドウ（PC）に出す手と、その手が指された後の局面。
 *
 * ウィンドウを開いている間は、見ている手に追従する。指し手と局面は、いま見ている手順の同じ手数
 * から引く（別の変化へ移っても、手と局面が食い違わない）。開始局面（0 手目）には出す手が無い
 * ので、その間だけウィンドウを出さない（手を進めるとまた出る）。
 */
export function resolveMoveDetail({
    isOpen,
    currentPly,
    kifMoves,
    positionHistory,
}: {
    isOpen: boolean;
    currentPly: number;
    kifMoves: readonly KifMove[];
    /** 「その手が指された後の局面」を 0 始まりで持つ（手数 ply の局面は `ply - 1`）。 */
    positionHistory: readonly PositionState[];
}): { move: KifMove; position: PositionState } | null {
    if (!isOpen || currentPly < 1) return null;
    const move = kifMoves.find((m) => m.ply === currentPly);
    const position = positionHistory[currentPly - 1];
    if (!move || !position) return null;
    return { move, position };
}

/**
 * 局面編集の操作（駒のドラッグ、マスを押しての配置、持ち駒の増減、成り・不成の切り替え）を
 * 受け付けてよいか。
 *
 * 棋譜を見るだけの画面（`viewerMode`）は局面編集を出さない。ところが内部の状態は
 * `initialReview` の取り込みが済むまで「編集モード」のままで、取り込みに失敗すると以後も
 * そのまま残る。その間に盤を編集できてしまわないよう、ビューアでは常に受け付けない。
 */
export function canEditPosition({
    isEditMode,
    viewerMode,
}: {
    isEditMode: boolean;
    viewerMode: boolean;
}): boolean {
    return isEditMode && !viewerMode;
}

/**
 * 盤を反転して（後手を手前にして）出すか。対局画面で、後手だけが人間のときに反転する。
 *
 * 先後の担当は対局画面の設定としてブラウザに保存されていて、棋譜を見る画面（棋譜ビューア・
 * 観戦・公開棋譜）もそれを読む。そこで反転すると、対局と関係のない棋譜が後手視点で開いて
 * しまうので、棋譜を見る画面では常に先手を手前にする（利用者は反転ボタンで切り替えられる）。
 */
export function shouldFlipBoardForSides({
    reviewMode,
    senteRole,
    goteRole,
}: {
    reviewMode: boolean;
    senteRole: SideSetting["role"];
    goteRole: SideSetting["role"];
}): boolean {
    if (reviewMode) return false;
    return goteRole === "human" && senteRole !== "human";
}
