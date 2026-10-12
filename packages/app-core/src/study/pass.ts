/**
 * 研究ノートでのパス（変則ルール「パス権」の手）の扱い。
 *
 * 研究ノートは対局の審判ではないので、パス権の回数は持たない。パスは、どの局面でも指せる手として
 * 扱う（棋譜にあるパスをそのまま再生でき、変化としても足せる）。
 *
 * 局面サービスやエンジンは、パス権が有効でないとパスを含む手順を読み込めない。そこへ渡すときは、
 * 「その手順で各側が使った回数 + 1」を初期のパス権とする（対局画面が、設定の無い棋譜に対して
 * 使っている決まりと同じ）。どの局面でも、双方があと 1 回パスできる前提になる。パスを含まない
 * 手順には何も渡さない（通常の将棋として扱う）。
 */

import { applyMoveWithState, type PositionState } from "../game/board";

/** 研究ノートでのパスの手の表記（USI の指し手の位置に入る。小文字だけ）。 */
export const STUDY_PASS_MOVE = "pass";

export function isStudyPassMove(move: string | null | undefined): boolean {
    return move === STUDY_PASS_MOVE;
}

/**
 * 1 つの手順で、片方の側が指せるパスの上限。エンジンが持てるパス権は各側 15 までで、
 * 渡すのは「使った回数 + 1」なので、使えるのは 14 回まで。
 */
export const STUDY_MAX_PASSES_PER_SIDE = 14;

/** 開始局面の手番が後手か（SFEN の 2 欄目。`startpos` は先手）。 */
const startsWithGote = (startSfen: string): boolean => {
    const fields = startSfen.trim().split(/\s+/);
    if (fields[0] === "position") fields.shift();
    if (fields[0] === "sfen") fields.shift();
    return fields[1] === "w";
};

/**
 * パスを含む手順を局面サービス・エンジンに渡すときの、初期のパス権。
 * パスを含まなければ undefined（パス権を有効にしない）。
 */
export function studyPassRightsForLine(
    startSfen: string,
    moves: readonly string[],
): { sente: number; gote: number } | undefined {
    if (!moves.some((move) => isStudyPassMove(move))) return undefined;
    let senteToMove = !startsWithGote(startSfen);
    let sente = 0;
    let gote = 0;
    for (const move of moves) {
        if (isStudyPassMove(move)) {
            if (senteToMove) sente += 1;
            else gote += 1;
        }
        senteToMove = !senteToMove;
    }
    return { sente: sente + 1, gote: gote + 1 };
}

/**
 * 手順が、エンジンに読み込めるパスの回数に収まっているか（各側 `STUDY_MAX_PASSES_PER_SIDE` 回まで）。
 * 収まらない手順は、取り込みでも「パスを指す」でも断る。
 */
export function studyLineFitsPassLimit(startSfen: string, moves: readonly string[]): boolean {
    const rights = studyPassRightsForLine(startSfen, moves);
    const limit = STUDY_MAX_PASSES_PER_SIDE + 1;
    return rights === undefined || (rights.sente <= limit && rights.gote <= limit);
}

/**
 * 読み筋などを 1 手ずつ進めるときの適用。パス権を数えていない局面（研究ノートの局面）では、
 * パスを指せる手として進める。パス権を数えている局面（対局画面）では、その残りに従う。
 */
export function applyMoveAllowingStudyPass(
    position: PositionState,
    move: string,
    options?: Parameters<typeof applyMoveWithState>[2],
): ReturnType<typeof applyMoveWithState> {
    if (!position.passRights && move.toLowerCase() === STUDY_PASS_MOVE) {
        return applyStudyMoveWithState(position, STUDY_PASS_MOVE);
    }
    return applyMoveWithState(position, move, options);
}

/**
 * 研究ノートの局面に手を適用する。パスは、パス権の残りに関係なく指せる（手番だけが替わる）。
 * 返す局面には、パス権の状態を持たせない（研究ノートは回数を数えない）。
 */
export function applyStudyMoveWithState(
    position: PositionState,
    move: string,
): ReturnType<typeof applyMoveWithState> {
    if (!isStudyPassMove(move)) return applyMoveWithState(position, move);
    const applied = applyMoveWithState({ ...position, passRights: { sente: 1, gote: 1 } }, move);
    if (!applied.ok) return { ...applied, next: position };
    const { passRights: _unused, ...next } = applied.next;
    return { ...applied, next };
}
