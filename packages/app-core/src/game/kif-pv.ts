/**
 * KIF / KI2 の表記で書かれた読み筋（`△３四歩▲２二角成△同　銀`、`△３四歩(33)` など）を、
 * 局面に照らして USI の手順にする。
 *
 * ShogiHome は読み筋を移動元なしの KI2 の表記で書き（同じ駒が複数あるときだけ `右`・`直` などを付ける）、
 * rshogi の `jsonl_to_kif` は移動元付き（`(33)`）で書く。どちらも読めるように、移動元が無ければ
 * その手番の駒のうち移動先へ動けるものを探して決める。
 */

import { BOARD_FILES, BOARD_RANKS, type PieceType, type PositionState, type Square } from "./board";
import { applyCsaMoveStrict } from "./csa-move";

/** 駒名 → 駒の種類と成っているか。 */
const PIECE_NAMES: Readonly<Record<string, { type: PieceType; promoted: boolean }>> = {
    玉: { type: "K", promoted: false },
    王: { type: "K", promoted: false },
    飛: { type: "R", promoted: false },
    龍: { type: "R", promoted: true },
    竜: { type: "R", promoted: true },
    角: { type: "B", promoted: false },
    馬: { type: "B", promoted: true },
    金: { type: "G", promoted: false },
    銀: { type: "S", promoted: false },
    成銀: { type: "S", promoted: true },
    全: { type: "S", promoted: true },
    桂: { type: "N", promoted: false },
    成桂: { type: "N", promoted: true },
    圭: { type: "N", promoted: true },
    香: { type: "L", promoted: false },
    成香: { type: "L", promoted: true },
    杏: { type: "L", promoted: true },
    歩: { type: "P", promoted: false },
    と: { type: "P", promoted: true },
};

const CSA_CODES: Readonly<Record<PieceType, readonly [string, string]>> = {
    K: ["OU", "OU"],
    R: ["HI", "RY"],
    B: ["KA", "UM"],
    G: ["KI", "KI"],
    S: ["GI", "NG"],
    N: ["KE", "NK"],
    L: ["KY", "NY"],
    P: ["FU", "TO"],
};

const DIGITS: Readonly<Record<string, number>> = {
    "１": 1,
    "２": 2,
    "３": 3,
    "４": 4,
    "５": 5,
    "６": 6,
    "７": 7,
    "８": 8,
    "９": 9,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
};

const MOVE_PATTERN =
    /^(?:([１-９1-9])([一二三四五六七八九１-９1-9])|同)(成銀|成桂|成香|玉|王|飛|龍|竜|角|馬|金|銀|全|桂|圭|香|杏|歩|と)(左|直|右)?(引|寄|上|行)?(不成|成|打)?(?:\(([1-9])([1-9])\))?$/;

const squareOf = (file: number, rank: number): Square =>
    `${file}${BOARD_RANKS[rank - 1]}` as Square;
const fileOf = (square: Square): number => Number(square[0]);
const rankOf = (square: Square): number =>
    BOARD_RANKS.indexOf(square[1] as (typeof BOARD_RANKS)[number]) + 1;
const csaSquare = (square: Square): string => `${fileOf(square)}${rankOf(square)}`;

/** 1 手を局面に照らして適用する。指せなければ null。 */
const tryMove = (
    state: PositionState,
    from: Square | null,
    to: Square,
    type: PieceType,
    promotedAfter: boolean,
): { move: string; nextState: PositionState } | null => {
    const sign = state.turn === "sente" ? "+" : "-";
    const code = CSA_CODES[type][promotedAfter ? 1 : 0];
    try {
        return applyCsaMoveStrict(
            `${sign}${from ? csaSquare(from) : "00"}${csaSquare(to)}${code}`,
            state,
        );
    } catch {
        return null;
    }
};

/**
 * 読み筋のテキストを、局面 `state` から USI の手順にする。読めない手・指せない手・
 * 移動元を 1 つに決められない手の手前で打ち切る。
 * @param lastTo 読み筋の 1 手目が「同」のときの移動先（直前に指された手の移動先）
 */
export function parseKifPv(state: PositionState, text: string, lastTo: Square | null): string[] {
    const pv: string[] = [];
    let current = state;
    let previousTo = lastTo;
    const sections = text
        .replace(/[\s　]/g, "")
        .split(/[▲△☗☖▼▽]/)
        .filter((section) => section !== "");
    for (const section of sections) {
        const match = MOVE_PATTERN.exec(section);
        if (!match) break;
        const [, fileText, rankText, name, horizontal, vertical, suffix, fromFile, fromRank] =
            match;
        const to = fileText ? squareOf(DIGITS[fileText], DIGITS[rankText]) : previousTo;
        const piece = PIECE_NAMES[name];
        if (!to || !piece) break;
        const promote = suffix === "成";
        let applied: { move: string; nextState: PositionState } | null = null;
        if (suffix === "打") {
            applied = tryMove(current, null, to, piece.type, false);
        } else if (fromFile && fromRank) {
            const from = squareOf(Number(fromFile), Number(fromRank));
            applied = tryMove(current, from, to, piece.type, piece.promoted || promote);
        } else {
            // 移動元が書かれていなければ、手番の同じ駒のうち移動先へ指せるものから選ぶ。
            const candidates: Array<{
                from: Square;
                result: { move: string; nextState: PositionState };
            }> = [];
            for (const file of BOARD_FILES) {
                for (const rank of BOARD_RANKS) {
                    const from = `${file}${rank}` as Square;
                    const occupant = current.board[from];
                    if (
                        !occupant ||
                        occupant.owner !== current.turn ||
                        occupant.type !== piece.type ||
                        (occupant.promoted === true) !== piece.promoted
                    ) {
                        continue;
                    }
                    const result = tryMove(
                        current,
                        from,
                        to,
                        piece.type,
                        piece.promoted || promote,
                    );
                    if (result) candidates.push({ from, result });
                }
            }
            const chosen = narrowCandidates(candidates, to, current.turn, horizontal, vertical);
            if (chosen) {
                applied = chosen.result;
            } else if (candidates.length === 0 && !piece.promoted && suffix === undefined) {
                // 盤上に動ける駒が無ければ、KI2 は「打」を省く。
                applied = tryMove(current, null, to, piece.type, false);
            }
        }
        if (!applied) break;
        pv.push(applied.move);
        current = applied.nextState;
        previousTo = to;
    }
    return pv;
}

/** 候補の駒を `左`・`右`・`直`・`上`・`引`・`寄` で 1 つに絞る。決まらなければ null。 */
function narrowCandidates<T extends { from: Square }>(
    candidates: T[],
    to: Square,
    turn: PositionState["turn"],
    horizontal: string | undefined,
    vertical: string | undefined,
): T | null {
    // 手番側から見て前へ進む量（先手は段の数字が減る向きが前）と、右へ寄る量（先手は筋の数字が減る向き）。
    const forwardOf = (from: Square) =>
        turn === "sente" ? rankOf(from) - rankOf(to) : rankOf(to) - rankOf(from);
    const rightOf = (from: Square) => (turn === "sente" ? -fileOf(from) : fileOf(from));
    let rest = candidates;
    if (vertical === "上" || vertical === "行") rest = rest.filter((c) => forwardOf(c.from) > 0);
    if (vertical === "引") rest = rest.filter((c) => forwardOf(c.from) < 0);
    if (vertical === "寄") rest = rest.filter((c) => forwardOf(c.from) === 0);
    if (horizontal === "直") {
        rest = rest.filter((c) => fileOf(c.from) === fileOf(to) && forwardOf(c.from) > 0);
    }
    if ((horizontal === "右" || horizontal === "左") && rest.length > 1) {
        const sorted = [...rest].sort((a, b) => rightOf(b.from) - rightOf(a.from));
        rest = [horizontal === "右" ? sorted[0] : sorted[sorted.length - 1]];
    }
    return rest.length === 1 ? rest[0] : null;
}
