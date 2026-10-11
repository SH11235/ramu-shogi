/**
 * CSA 棋譜の開始局面を読む。
 *
 * 対応する書き方:
 * - `PI` (平手)。`PI82HI22KA` のように落とす駒を並べた駒落ち指定も読む
 * - `P1`〜`P9` の一括表現 (1 行が 1 段、1 マス 3 文字)
 * - `P+` / `P-` の駒別表現 (`P+63FU` はマス指定、`P+00KA` は持ち駒)
 * - 手番行 (`+` / `-`)
 *
 * `P+00AL` / `P-00AL` は、盤上にも相手の持ち駒にも無い残りの駒 (玉を除く) をすべて
 * その側の持ち駒にする。解釈できない記述は例外にして、誤った局面からの再生をさせない。
 */

import {
    BOARD_FILES,
    BOARD_RANKS,
    type BoardState,
    createEmptyHands,
    createInitialBoard,
    type Hands,
    type Piece,
    type PieceType,
    type Player,
    type PositionState,
    type Square,
} from "./board";

export interface CsaStartPosition {
    /** 開始局面 (盤・持ち駒・手番)。 */
    position: PositionState;
    /**
     * 開始局面の SFEN (`<盤> <手番> <持ち駒> 1`)。
     * 平手・先手番のときだけ `"startpos"` を返す。
     */
    sfen: string;
}

/** CSA の駒コード → 駒の種類と成りの有無。 */
export const CSA_PIECE_CODES: Record<string, { type: PieceType; promoted: boolean } | undefined> = {
    FU: { type: "P", promoted: false },
    KY: { type: "L", promoted: false },
    KE: { type: "N", promoted: false },
    GI: { type: "S", promoted: false },
    KI: { type: "G", promoted: false },
    KA: { type: "B", promoted: false },
    HI: { type: "R", promoted: false },
    OU: { type: "K", promoted: false },
    TO: { type: "P", promoted: true },
    NY: { type: "L", promoted: true },
    NK: { type: "N", promoted: true },
    NG: { type: "S", promoted: true },
    UM: { type: "B", promoted: true },
    RY: { type: "R", promoted: true },
};

/** 1 組の駒の枚数 (玉を除く)。`00AL` の残り駒の計算に使う。 */
const FULL_SET: Readonly<Record<Exclude<PieceType, "K">, number>> = {
    P: 18,
    L: 4,
    N: 4,
    S: 4,
    G: 4,
    B: 2,
    R: 2,
};

/** SFEN の持ち駒の並び順。 */
const SFEN_HAND_ORDER: readonly PieceType[] = ["R", "B", "G", "S", "N", "L", "P"];

const fail = (line: string, reason: string): never => {
    throw new Error(`CSA の開始局面を解釈できません: ${line} (${reason})`);
};

const createEmptyBoard = (): BoardState => {
    const board = {} as BoardState;
    for (const rank of BOARD_RANKS) {
        for (const file of BOARD_FILES) {
            board[`${file}${rank}` as Square] = null;
        }
    }
    return board;
};

/** CSA のマス表記 (`76` = 7 筋 6 段) を内部のマスに直す。 */
const toSquare = (value: string): Square | null => {
    const file = value[0];
    const rankIndex = Number(value[1]) - 1;
    if (!BOARD_FILES.includes(file as (typeof BOARD_FILES)[number])) return null;
    const rank = BOARD_RANKS[rankIndex];
    if (!rank) return null;
    return `${file}${rank}` as Square;
};

const toPiece = (owner: Player, code: string): Piece | null => {
    const piece = CSA_PIECE_CODES[code];
    if (!piece) return null;
    return piece.promoted
        ? { owner, type: piece.type, promoted: true }
        : { owner, type: piece.type };
};

/** `P1`〜`P9` の 1 行を盤に置く。 */
const applyRowLine = (board: BoardState, line: string): void => {
    const rank = BOARD_RANKS[Number(line[1]) - 1];
    const body = line.slice(2);
    if (body.slice(27).trim().length > 0) fail(line, "1 段は 9 マスです");
    BOARD_FILES.forEach((file, index) => {
        const cell = body.slice(index * 3, index * 3 + 3).trim();
        if (cell === "" || cell === "*") return;
        const owner = cell[0] === "+" ? "sente" : cell[0] === "-" ? "gote" : null;
        const piece = owner && cell.length === 3 ? toPiece(owner, cell.slice(1)) : null;
        if (!piece) fail(line, `駒を解釈できません: ${cell}`);
        board[`${file}${rank}` as Square] = piece;
    });
};

/** `PI` の後ろに並んだ落とす駒 (`82HI` など) を平手の盤から取り除く。 */
const applyHandicapLine = (board: BoardState, line: string): void => {
    const body = line.slice(2).trim();
    if (body.length % 4 !== 0) fail(line, "落とす駒は 4 文字ずつ並べます");
    for (let i = 0; i < body.length; i += 4) {
        const item = body.slice(i, i + 4);
        const square = toSquare(item.slice(0, 2));
        const expected = CSA_PIECE_CODES[item.slice(2)];
        const current = square ? board[square] : null;
        if (
            !square ||
            !expected ||
            !current ||
            current.type !== expected.type ||
            (current.promoted === true) !== expected.promoted
        ) {
            fail(line, `平手の配置に無い駒です: ${item}`);
            return;
        }
        board[square] = null;
    }
};

/**
 * `P+` / `P-` の駒別表現を盤・持ち駒に置く。
 * `00AL` があればその側を返す (残りの駒は、すべての行を置き終えてから配る)。
 */
const applyPieceLine = (board: BoardState, hands: Hands, line: string): Player | null => {
    let allRemainingTo: Player | null = null;
    const owner: Player = line[1] === "+" ? "sente" : "gote";
    const body = line.slice(2).trim();
    if (body.length % 4 !== 0) fail(line, "駒は 4 文字ずつ並べます");
    for (let i = 0; i < body.length; i += 4) {
        const item = body.slice(i, i + 4);
        const where = item.slice(0, 2);
        const code = item.slice(2);
        const piece = toPiece(owner, code);
        if (where === "00") {
            if (code === "AL") {
                allRemainingTo = owner;
                continue;
            }
            if (!piece || piece.promoted || piece.type === "K") {
                fail(line, `持ち駒にできない駒です: ${item}`);
                return null;
            }
            hands[owner][piece.type] = (hands[owner][piece.type] ?? 0) + 1;
            continue;
        }
        const square = toSquare(where);
        if (!square || !piece) {
            fail(line, `駒を解釈できません: ${item}`);
            return null;
        }
        if (board[square]) fail(line, `マスが重複しています: ${item}`);
        board[square] = piece;
    }
    return allRemainingTo;
};

/** 盤上にもどちらの持ち駒にも無い駒を、すべて `owner` の持ち駒にする (`00AL`)。 */
const giveRemainingPieces = (
    board: BoardState,
    hands: Hands,
    owner: Player,
    line: string,
): void => {
    const used: Partial<Record<PieceType, number>> = {};
    for (const piece of Object.values(board)) {
        if (piece) used[piece.type] = (used[piece.type] ?? 0) + 1;
    }
    for (const side of ["sente", "gote"] as const) {
        for (const [type, count] of Object.entries(hands[side])) {
            used[type as PieceType] = (used[type as PieceType] ?? 0) + (count ?? 0);
        }
    }
    for (const [type, total] of Object.entries(FULL_SET)) {
        const pieceType = type as Exclude<PieceType, "K">;
        const remaining = total - (used[pieceType] ?? 0);
        if (remaining < 0) fail(line, "駒の枚数が 1 組を超えています");
        if (remaining > 0) hands[owner][pieceType] = (hands[owner][pieceType] ?? 0) + remaining;
    }
};

const sfenLetter = (piece: Piece): string => {
    const letter = piece.owner === "sente" ? piece.type : piece.type.toLowerCase();
    return piece.promoted ? `+${letter}` : letter;
};

const boardToSfen = (board: BoardState): string =>
    BOARD_RANKS.map((rank) => {
        let row = "";
        let empty = 0;
        for (const file of BOARD_FILES) {
            const piece = board[`${file}${rank}` as Square];
            if (!piece) {
                empty++;
                continue;
            }
            if (empty > 0) row += String(empty);
            empty = 0;
            row += sfenLetter(piece);
        }
        return empty > 0 ? row + String(empty) : row;
    }).join("/");

const handsToSfen = (hands: Hands): string => {
    let text = "";
    for (const owner of ["sente", "gote"] as const) {
        for (const type of SFEN_HAND_ORDER) {
            const count = hands[owner][type] ?? 0;
            if (count <= 0) continue;
            const letter = owner === "sente" ? type : type.toLowerCase();
            text += count > 1 ? `${count}${letter}` : letter;
        }
    }
    return text.length > 0 ? text : "-";
};

/**
 * 開始局面を表す行 (`PI...` / `P1`〜`P9` / `P+...` / `P-...`) と手番から局面を組み立てる。
 * 局面を表す行が 1 つも無ければ平手とみなす。
 */
export function buildCsaStartPosition(
    setupLines: readonly string[],
    turn: Player = "sente",
): CsaStartPosition {
    const piLine = setupLines.find((line) => line.startsWith("PI"));
    const rowLines = setupLines.filter((line) => /^P[1-9]/.test(line));
    const pieceLines = setupLines.filter((line) => /^P[+-]/.test(line));
    for (const line of setupLines) {
        if (!/^P(?:I|[1-9]|[+-])/.test(line)) fail(line, "未対応の局面記述です");
    }
    if (piLine && rowLines.length > 0) fail(piLine, "PI と P1〜P9 は併用できません");

    let board: BoardState;
    if (rowLines.length > 0) {
        const seen = new Set<string>();
        for (const line of rowLines) {
            if (seen.has(line[1])) fail(line, "同じ段が 2 回あります");
            seen.add(line[1]);
        }
        if (seen.size !== 9) fail(rowLines[0], "P1〜P9 の 9 段すべてが必要です");
        board = createEmptyBoard();
        for (const line of rowLines) applyRowLine(board, line);
    } else if (piLine || pieceLines.length === 0) {
        board = createInitialBoard();
        if (piLine) applyHandicapLine(board, piLine);
    } else {
        board = createEmptyBoard();
    }

    const hands = createEmptyHands();
    let allRemaining: { owner: Player; line: string } | null = null;
    for (const line of pieceLines) {
        const owner = applyPieceLine(board, hands, line);
        if (owner && allRemaining && allRemaining.owner !== owner) {
            fail(line, "00AL は片方の側にだけ書けます");
        }
        if (owner) allRemaining = { owner, line };
    }
    if (allRemaining) giveRemainingPieces(board, hands, allRemaining.owner, allRemaining.line);

    const boardSfen = boardToSfen(board);
    const handsSfen = handsToSfen(hands);
    const isHirate =
        turn === "sente" && handsSfen === "-" && boardSfen === boardToSfen(createInitialBoard());
    return {
        position: { board, hands, turn, ply: 1 },
        sfen: isHirate ? "startpos" : `${boardSfen} ${turn === "sente" ? "b" : "w"} ${handsSfen} 1`,
    };
}

/**
 * CSA 棋譜の本文から開始局面を取り出して SFEN にする。
 * 最初の指し手より前にある局面の行と手番行だけを見る。
 */
export function parseCsaStartPosition(contents: string): CsaStartPosition {
    const setupLines: string[] = [];
    let turn: Player | undefined;
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (line === "+" || line === "-") {
            turn = line === "+" ? "sente" : "gote";
            continue;
        }
        if (line === "/" || /^[+\-%]/.test(line)) break;
        if (/^P(?:I|[1-9]|[+-])/.test(line)) setupLines.push(line);
    }
    return buildCsaStartPosition(setupLines, turn);
}
