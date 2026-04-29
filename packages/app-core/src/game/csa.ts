import {
    applyMove,
    applyMoveWithState,
    BOARD_FILES,
    BOARD_RANKS,
    type BoardState,
    boardFromMoves,
    cloneBoard,
    createEmptyHands,
    createInitialBoard,
    type Piece,
    type PieceType,
    type PositionState,
    type Square,
} from "./board";

const RANK_TO_NUMBER: Record<string, string> = Object.fromEntries(
    BOARD_RANKS.map((rank, index) => [rank, String(index + 1)]),
);

const NUMBER_TO_RANK: Record<string, string> = Object.fromEntries(
    BOARD_RANKS.map((rank, index) => [String(index + 1), rank]),
);

const PROMOTED_CODES: Record<PieceType, string> = {
    P: "TO",
    L: "NY",
    N: "NK",
    S: "NG",
    B: "UM",
    R: "RY",
    G: "KI",
    K: "OU",
};

const PIECE_CODES: Record<PieceType, string> = {
    P: "FU",
    L: "KY",
    N: "KE",
    S: "GI",
    G: "KI",
    B: "KA",
    R: "HI",
    K: "OU",
};

const PROMOTED_FROM_CODE: Record<string, PieceType | undefined> = {
    TO: "P",
    NY: "L",
    NK: "N",
    NG: "S",
    UM: "B",
    RY: "R",
};

/**
 * 駒打ち時の CSA 駒コード (`FU`/`KY`/`KE`/`GI`/`KI`/`KA`/`HI`) → `PieceType` の逆引き。
 *
 * 駒打ちは成り駒では行わないため、成りコード (`TO`/`NY`/...) は対応外。
 * `OU` は王なので駒打ちに現れない。
 */
const DROP_PIECE_FROM_CODE: Record<string, PieceType | undefined> = {
    FU: "P",
    KY: "L",
    KE: "N",
    GI: "S",
    KI: "G",
    KA: "B",
    HI: "R",
};

/**
 * 1 行の CSA `move` 行から USI move 文字列を解釈する純粋関数。
 *
 * 受け付ける書式:
 * - 通常移動: `+7776FU` / `-3334FU` / `+8822UM` (成り駒コード時は移動元駒の状態で
 *   「成り (UM=馬を新規生成)」か「既成り駒の通常移動 (馬→馬の単純移動)」かを判別)
 * - 駒打ち: `+0099FU` 等 (from = `"00"`、駒コードは非成り駒のみ)
 *
 * 戻り値が `null` のときは move 行ではない (時間行 `T8` / コメント `'...` /
 * 終局コード `%TORYO` / `#RESIGN` 等)。本関数では state 検証や合法手チェックは
 * 行わず、wire 上で構文として解釈可能な行だけを USI 文字列化する。
 *
 * `fromPiecePromoted` が `true`/`false` で渡されたときは、移動元の駒が既に成り駒
 * かどうかで `+` 付与を抑止する。`undefined` の場合は board 文脈不明として
 * 「駒コードが成り駒コードならすべて promote=true」とする後方互換 fallback
 * (この場合、既成り駒の通常移動でも `+` が付与され不正な USI になる場合があるが、
 * 後段の `applyMoveWithState` で弾かれる)。
 */
function parseCsaMoveLine(line: string, fromPiecePromoted?: boolean): { usi: string } | null {
    if (!(line.startsWith("+") || line.startsWith("-"))) {
        return null;
    }
    if (line.length < 7) {
        return null;
    }
    const fromRaw = line.slice(1, 3);
    const toRaw = line.slice(3, 5);
    const pieceCode = line.slice(5, 7).toUpperCase();
    const toSquare = fromCsaSquare(toRaw);
    if (!toSquare) {
        return null;
    }
    if (fromRaw === "00") {
        const piece = DROP_PIECE_FROM_CODE[pieceCode];
        if (!piece) {
            return null;
        }
        // USI の駒打ち書式は `P*5e` (大文字駒コード + `*` + マス)。
        return { usi: `${piece}*${toSquare}` };
    }
    const fromSquare = fromCsaSquare(fromRaw);
    if (!fromSquare) {
        return null;
    }
    // 駒コードが成り駒 (TO/NY/NK/NG/UM/RY) でかつ「移動元が未成りの駒」のときに
    // のみ promote = true。移動元が既に成り駒の場合は「成り駒の通常移動」なので
    // `+` を付けない (例: 龍が 5e→4e 移動 → `+5e4eRY` → USI `5e4e`)。
    const isPromotedCode = PROMOTED_FROM_CODE[pieceCode] !== undefined;
    const promotes = isPromotedCode && fromPiecePromoted === false;
    return { usi: `${fromSquare}${toSquare}${promotes ? "+" : ""}` };
}

/**
 * 1 行の CSA move 行 (`+7776FU` / `+0099FU` 等) を解釈し、適用後の `PositionState`
 * と USI 表現を返す。
 *
 * 戻り値が `null` のときは行が move ではない (時間行 / コメント / 終局コード等)。
 * `applyMoveWithState` の戻り値が `ok: false` のときも `null` を返す (= 不正手は
 * 呼び出し側で検出させる)。
 *
 * `state` には board + hands + turn + ply を含む `PositionState` を渡す契約。
 * 駒打ち手 (`+0099FU` 等) は `hands` を参照しないと適用できないため、`BoardState`
 * 単体ではなく `PositionState` 全体を取る。
 *
 * 内部では既存 `applyMoveWithState` を `validateTurn: false` で呼び、wire 由来の
 * 手を idempotent に適用する (= サーバが手番・合法性・在駒を保証している前提)。
 * `ignoreHandLimits` は既定 (`false`) のままにしておくことで、駒打ち時に hands
 * が自然に減算され、観戦 UI で持ち駒表示が壊れない。サーバ側で hands と
 * boardState の整合が崩れたケース (= 何らかのバグ) では `applyMoveWithState`
 * が `ok: false` を返すため本関数は `null` を返す。
 */
export function parseSingleCsaMove(
    line: string,
    state: PositionState,
): { move: string; nextState: PositionState } | null {
    const trimmed = line.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length < 7) return null;
    const fromRaw = trimmed.slice(1, 3);
    // 駒打ちは fromPiecePromoted が無関係。通常移動の場合のみ移動元駒の成り
    // フラグを参照して、`parseCsaMoveLine` の `+` 付与制御を行う。
    let fromPiecePromoted: boolean | undefined;
    if (fromRaw !== "00" && (trimmed.startsWith("+") || trimmed.startsWith("-"))) {
        const fromSquare = fromCsaSquare(fromRaw);
        if (fromSquare) {
            const piece = state.board[fromSquare];
            fromPiecePromoted = piece ? piece.promoted === true : undefined;
        }
    }
    const parsed = parseCsaMoveLine(trimmed, fromPiecePromoted);
    if (!parsed) return null;
    const result = applyMoveWithState(state, parsed.usi, {
        validateTurn: false,
    });
    if (!result.ok) return null;
    return { move: parsed.usi, nextState: result.next };
}

/**
 * 複数行の CSA テキストから `parseSingleCsaMove` をループ適用する。
 *
 * snapshot 受信時に moves[] と最新 `PositionState` の両方が必要な観戦 client
 * から使う。`parseCsaMoves` (board-only) と異なり hands / turn / ply も追跡
 * するため、`parseSingleCsaMove` で broadcast move を逐次適用する経路と
 * 整合する。
 *
 * 戻り値の `state` は最後に適用された手の直後の `PositionState`。move 行が 0 件の
 * 場合は `initialState` を deep clone せずそのまま返す (呼び出し側で必要なら
 * clone する契約)。
 */
export function parseCsaMovesWithState(
    contents: string,
    initialState: PositionState,
): { moves: string[]; state: PositionState } {
    const lines = contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const moves: string[] = [];
    let state = initialState;
    for (const line of lines) {
        const applied = parseSingleCsaMove(line, state);
        if (!applied) continue;
        moves.push(applied.move);
        state = applied.nextState;
    }
    return { moves, state };
}

interface CsaMetadata {
    senteName?: string;
    goteName?: string;
}

const resolveInitialBoard = (initialBoard?: BoardState): BoardState => {
    if (initialBoard) return cloneBoard(initialBoard);
    try {
        return createInitialBoard();
    } catch (error) {
        throw new Error(
            `初期盤面を取得できませんでした: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
};

export function movesToCsa(
    moves: string[],
    metadata: CsaMetadata = {},
    initialBoard?: BoardState,
): string {
    const lines: string[] = [
        "V2.2",
        `N+${metadata.senteName ?? "Sente"}`,
        `N-${metadata.goteName ?? "Gote"}`,
        "PI",
        "+",
    ];
    let board = resolveInitialBoard(initialBoard);
    moves.forEach((move, index) => {
        const parsed = parseUsiMove(move);
        if (!parsed) {
            console.warn(`Failed to parse USI move at index ${index}: ${move}`);
            return;
        }
        const piece = board[parsed.from];
        if (!piece) {
            return;
        }
        const sign = index % 2 === 0 ? "+" : "-";
        const pieceCode = determinePieceCode(piece, move.endsWith("+"));
        lines.push(`${sign}${toCsaSquare(parsed.from)}${toCsaSquare(parsed.to)}${pieceCode}`);
        board = applyMove(board, move);
    });

    return lines.join("\n");
}

export function parseCsaMoves(contents: string, initialBoard?: BoardState): string[] {
    const lines = contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const moves: string[] = [];
    let board = resolveInitialBoard(initialBoard);
    for (const line of lines) {
        if (!(line.startsWith("+") || line.startsWith("-"))) {
            continue;
        }
        if (line.length < 7) {
            continue;
        }
        const fromSquare = fromCsaSquare(line.slice(1, 3));
        const toSquare = fromCsaSquare(line.slice(3, 5));
        if (!fromSquare || !toSquare) {
            continue;
        }
        const pieceCode = line.slice(5, 7).toUpperCase();
        const targetPiece = board[fromSquare];
        if (!targetPiece) {
            continue;
        }
        // 「駒コードが成り駒コード」かつ「移動元の駒が未成り」の場合のみ promote。
        // 既成り駒の通常移動 (例: 龍 RY が移動) では `+` を付与しない。
        const isPromotedCode = PROMOTED_FROM_CODE[pieceCode] !== undefined;
        const promotes = isPromotedCode && targetPiece.promoted !== true;
        const move = `${fromSquare}${toSquare}${promotes ? "+" : ""}`;
        moves.push(move);
        board = applyMove(board, move);
    }
    return moves;
}

export function buildBoardFromCsa(contents: string, initialBoard?: BoardState): BoardState {
    const moves = parseCsaMoves(contents, initialBoard);
    const start = resolveInitialBoard(initialBoard);
    return boardFromMoves(moves, { board: start, hands: createEmptyHands(), turn: "sente" });
}

function toCsaSquare(square: Square): string {
    const file = square[0];
    const rank = square[1];
    return `${file}${RANK_TO_NUMBER[rank]}`;
}

function fromCsaSquare(value: string): Square | null {
    if (value.length !== 2) {
        return null;
    }
    const [file, rank] = value.split("");
    if (!BOARD_FILES.includes(file as (typeof BOARD_FILES)[number])) {
        return null;
    }
    const mappedRank = NUMBER_TO_RANK[rank];
    if (!mappedRank) {
        return null;
    }
    return `${file}${mappedRank}` as Square;
}

function parseUsiMove(move: string): { from: Square; to: Square } | null {
    const cleaned = move.replace("+", "");
    if (cleaned.length < 4) {
        return null;
    }
    const from = cleaned.slice(0, 2) as Square;
    const to = cleaned.slice(2, 4) as Square;
    return { from, to };
}

function determinePieceCode(piece: Piece, promoted: boolean): string {
    if (promoted) {
        return PROMOTED_CODES[piece.type] ?? PIECE_CODES[piece.type];
    }
    return PIECE_CODES[piece.type];
}
