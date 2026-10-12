import {
    BOARD_FILES,
    BOARD_RANKS,
    type PieceType,
    type PositionState,
    type Square,
} from "../game/board";
import { yieldTask } from "./yieldTask";

export interface BookMove {
    usi: string;
    value: number;
    depth: number;
    count: number;
}
export interface BookWarning {
    line: number;
    message: string;
}
export interface BookData {
    positions: Map<string, BookMove[]>;
    warnings: BookWarning[];
    stats: { positions: number; moves: number; sente: number; gote: number; branches: number };
}
const HAND_ORDER: PieceType[] = ["R", "B", "G", "S", "N", "L", "P"];
const USI = /^(?:[1-9][a-i][1-9][a-i]\+?|[RBGSNLP]\*[1-9][a-i])$/;

export function positionToBookKey(position: PositionState): string {
    const rows = BOARD_RANKS.map((rank) => {
        let row = "";
        let empty = 0;
        for (const file of BOARD_FILES) {
            const piece = position.board[`${file}${rank}` as Square];
            if (!piece) {
                empty++;
                continue;
            }
            if (empty) {
                row += empty;
                empty = 0;
            }
            row +=
                (piece.promoted ? "+" : "") +
                (piece.owner === "sente" ? piece.type : piece.type.toLowerCase());
        }
        return row + (empty || "");
    });
    let hands = "";
    for (const owner of ["sente", "gote"] as const) {
        for (const type of HAND_ORDER) {
            const count = position.hands[owner][type] ?? 0;
            if (count > 0)
                hands +=
                    (count > 1 ? String(count) : "") +
                    (owner === "sente" ? type : type.toLowerCase());
        }
    }
    return `${rows.join("/")} ${position.turn === "sente" ? "b" : "w"} ${hands || "-"}`;
}

export function normalizeBookKey(sfen: string): string {
    const fields = sfen
        .trim()
        .replace(/^sfen\s+/, "")
        .split(/\s+/);
    if (
        fields.length < 3 ||
        fields.length > 4 ||
        (fields[3] !== undefined && !/^\d+$/.test(fields[3])) ||
        (fields[1] !== "b" && fields[1] !== "w")
    )
        throw new Error("局面の形式が正しくありません");
    const rows = fields[0].split("/");
    if (rows.length !== 9) throw new Error("盤面は 9 段必要です");
    for (const row of rows) {
        if (/[1-9]{2}/.test(row)) throw new Error("盤面の空きマスの数字が連続しています");
        let width = 0;
        for (let i = 0; i < row.length; i++) {
            const ch = row[i];
            if (ch >= "1" && ch <= "9") width += Number(ch);
            else {
                const promoted = ch === "+";
                const piece = promoted ? row[++i] : ch;
                if (!piece || !(promoted ? "RBSNLPrbsnlp" : "KRBGSNLPkrbgsnlp").includes(piece))
                    throw new Error("盤面の駒が不正です");
                width++;
            }
            if (width > 9) throw new Error("盤面の幅が不正です");
        }
        if (width !== 9) throw new Error("盤面の幅が不正です");
    }
    let hands = "";
    if (fields[2] !== "-") {
        if (!/^(?:(?:[1-9]\d*)?[RBGSNLPrbgsnlp])+$/.test(fields[2]))
            throw new Error("持ち駒の形式が不正です");
        const counts: Record<string, number> = {};
        for (const match of fields[2].matchAll(/(\d*)([RBGSNLPrbgsnlp])/g)) {
            const piece = match[2];
            const count = (counts[piece] ?? 0) + (match[1] ? Number(match[1]) : 1);
            if (!Number.isSafeInteger(count)) throw new Error("持ち駒の枚数が不正です");
            counts[piece] = count;
        }
        for (const piece of "RBGSNLPrbgsnlp") {
            const count = counts[piece];
            if (count) hands += (count > 1 ? String(count) : "") + piece;
        }
    }
    return `${fields[0]} ${fields[1]} ${hands || "-"}`;
}

function integer(value: string | undefined): number {
    if (value === undefined) return 0;
    if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new Error("数値の形式が正しくありません");
    return Number(value);
}

function* parseBookChunks(text: string): Generator<void, BookData> {
    const entries = new Map<string, Map<string, BookMove>>();
    const warnings: BookWarning[] = [];
    let current: Map<string, BookMove> | undefined;
    const entryLines = new Map<string, number>();
    let index = -1;
    for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
        const raw = match[0];
        index++;
        if (index % 256 === 0) yield;
        const line = raw.trim();
        if (!line || line.startsWith("#") || line.startsWith("//")) continue;
        try {
            if (/^sfen(?:\s|$)/.test(line)) {
                current = undefined;
                const key = normalizeBookKey(line);
                current = entries.get(key) ?? new Map();
                entries.set(key, current);
                entryLines.set(key, index + 1);
            } else {
                const fields = line.split(/\s+/);
                if (
                    !current ||
                    !USI.test(fields[0]) ||
                    (fields[1] !== undefined && fields[1] !== "none" && !USI.test(fields[1]))
                )
                    throw new Error("指し手の形式または直前の局面が不正です");
                const move = {
                    usi: fields[0],
                    value: integer(fields[2]),
                    depth: integer(fields[3]),
                    count: integer(fields[4]),
                };
                if (move.depth < 0 || move.count < 0) {
                    warnings.push({
                        line: index + 1,
                        message: "負の深さ・採択数を 0 として扱います",
                    });
                    move.depth = Math.max(0, move.depth);
                    move.count = Math.max(0, move.count);
                }
                current.set(move.usi, move);
            }
        } catch (error) {
            warnings.push({
                line: index + 1,
                message: error instanceof Error ? error.message : "不正な行です",
            });
        }
    }
    const positions = new Map<string, BookMove[]>();
    const stats = { positions: 0, moves: 0, sente: 0, gote: 0, branches: 0 };
    let processed = 0;
    for (const [key, moves] of entries) {
        if (++processed % 256 === 0) yield;
        if (!moves.size) {
            warnings.push({
                line: entryLines.get(key) ?? 1,
                message: "手のない局面は登録しません",
            });
            continue;
        }
        stats.positions++;
        positions.set(key, [...moves.values()]);
        stats.moves += moves.size;
        stats[key.split(" ")[1] === "b" ? "sente" : "gote"]++;
        if (moves.size >= 2) stats.branches++;
    }
    warnings.sort((a, b) => a.line - b.line);
    return { positions, warnings, stats };
}

export function parseBookExplore(text: string): {
    positions: Map<string, string[]>;
    warnings: BookWarning[];
} {
    const positions = new Map<string, string[]>();
    const warnings: BookWarning[] = [];
    text.split(/\r?\n/).forEach((raw, index) => {
        const line = raw.trim();
        if (!line || line.startsWith("#")) return;
        try {
            const [prefix, ...fields] = line.split(/\s+/);
            const offset = /^\d+$/.test(fields[3] ?? "") ? 4 : 3;
            const moves = fields.slice(offset);
            if (prefix !== "sfen" || !moves.length || moves.some((move) => !USI.test(move)))
                throw new Error("プリセットの形式が正しくありません");
            positions.set(normalizeBookKey(fields.slice(0, offset).join(" ")), [...new Set(moves)]);
        } catch (error) {
            warnings.push({
                line: index + 1,
                message: error instanceof Error ? error.message : "不正な行です",
            });
        }
    });
    return { positions, warnings };
}

export function serializeBookExplore(positions: ReadonlyMap<string, readonly string[]>): string {
    return [...positions]
        .map(([key, moves]) => {
            if (!moves.length || moves.some((move) => !USI.test(move)))
                throw new Error("プリセットの指し手が不正です");
            return `sfen ${normalizeBookKey(key)} 1 ${[...new Set(moves)].join(" ")}\n`;
        })
        .join("");
}

export function parseBook(text: string): BookData {
    const chunks = parseBookChunks(text);
    let result = chunks.next();
    while (!result.done) result = chunks.next();
    return result.value;
}

export async function parseBookAsync(
    text: string,
    cancelled: () => boolean = () => false,
): Promise<BookData> {
    const chunks = parseBookChunks(text);
    let started = performance.now();
    let result = chunks.next();
    while (!result.done) {
        if (cancelled()) throw new Error("読み込みを中止しました");
        if (performance.now() - started >= 12) {
            await yieldTask();
            started = performance.now();
        }
        result = chunks.next();
    }
    return result.value;
}

export async function findBookBranchesAsync(
    book: BookData,
    cancelled: () => boolean = () => false,
): Promise<Record<PositionState["turn"], string[]>> {
    const branches: Record<PositionState["turn"], string[]> = { sente: [], gote: [] };
    let started = performance.now();
    for (const [key, moves] of book.positions) {
        if (cancelled()) throw new Error("読み込みを中止しました");
        if (moves.length >= 2) branches[key.split(" ")[1] === "b" ? "sente" : "gote"].push(key);
        if (performance.now() - started >= 12) {
            await yieldTask();
            started = performance.now();
        }
    }
    return branches;
}
