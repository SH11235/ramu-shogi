import { describe, expect, it } from "vitest";
import { parseStudySfen } from "../study/sfen";
import { BOARD_FILES, BOARD_RANKS, type PieceType, type PositionState, type Square } from "./board";
import { canMoveOnBoard } from "./csa-move";
import { parseKifPv } from "./kif-pv";
import { canPromoteOnMove, dropNeedsMarker, relativeMoveNotation } from "./move-notation";

const notationOf = (sfen: string, move: string): string =>
    relativeMoveNotation(
        parseStudySfen(sfen).board,
        move.slice(0, 2) as Square,
        move.slice(2, 4) as Square,
    );

describe("relativeMoveNotation", () => {
    it("動ける駒が 1 枚なら何も付けない", () => {
        const start = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
        expect(notationOf(start, "6i7h")).toBe("");
        expect(notationOf(start, "7g7f")).toBe("");
    });

    it("平手の 5八 へは、6九の金が左・4九の金が右", () => {
        const start = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
        expect(notationOf(start, "6i5h")).toBe("左");
        expect(notationOf(start, "4i5h")).toBe("右");
    });

    it("銀: 右上で決め、成りの有無は相対表記に影響しない", () => {
        // 銀が 9四・8四・8二。どれも 9三 へ動ける。
        const sfen = "4k4/1S7/9/SS7/9/9/9/9/4K4 b - 1";
        expect(notationOf(sfen, "8d9c+")).toBe("右上");
        expect(notationOf(sfen, "9d9c")).toBe("直");
        expect(notationOf(sfen, "8b9c")).toBe("引");
    });

    it("桂は左・右で決める", () => {
        const sfen = "4k4/9/9/9/9/9/9/9/1N1NK4 b - 1";
        expect(notationOf(sfen, "8i7g")).toBe("左");
        expect(notationOf(sfen, "6i7g")).toBe("右");
    });

    it("馬はまっすぐ上がっても直を使わない", () => {
        // 馬が 5六・8八。どちらも 5五 へ上がる。
        const sfen = "k8/9/9/9/9/4+B4/9/1+B7/K8 b - 1";
        expect(notationOf(sfen, "5f5e")).toBe("右");
        expect(notationOf(sfen, "8h5e")).toBe("左");
    });

    it("飛 2 枚が横から寄るときは左・右", () => {
        const sfen = "k8/9/9/9/R7R/9/9/9/K8 b - 1";
        expect(notationOf(sfen, "9e5e")).toBe("左");
        expect(notationOf(sfen, "1e5e")).toBe("右");
    });

    it("後手は左右・上下を後手から見て決める", () => {
        // 後手の金が 6一・4一。後手から見て右は 6一。
        const sides = "3g1g3/9/4k4/9/9/9/9/9/4K4 w - 1";
        expect(notationOf(sides, "6a5b")).toBe("右");
        expect(notationOf(sides, "4a5b")).toBe("左");
        // 後手の金が 5一・5三。後手にとって 5一 → 5二 は上。
        const file = "4g4/9/4g4/9/9/9/9/9/k3K4 w - 1";
        expect(notationOf(file, "5a5b")).toBe("上");
        expect(notationOf(file, "5c5b")).toBe("引");
    });

    it("指すと自玉に利きが通る駒は数えない", () => {
        // 4八の金は 4一の香で玉にピンされている。
        const pinned = "k4l3/9/9/9/9/9/9/3G1G3/5K3 b - 1";
        expect(notationOf(pinned, "6h5g")).toBe("");
        const free = "k8/9/9/9/9/9/9/3G1G3/5K3 b - 1";
        expect(notationOf(free, "6h5g")).toBe("左");
    });

    it("成桂がまっすぐ上がる手は直", () => {
        const sfen = "4k4/9/9/9/9/3+N+N+N3/9/9/4K4 b - 1";
        expect(notationOf(sfen, "5f5e")).toBe("直");
        expect(notationOf(sfen, "6f5e")).toBe("左");
        expect(notationOf("4k4/9/9/9/9/3+N+N4/9/9/4K4 b - 1", "5f5e")).toBe("直");
    });

    it("盤の外を指す座標では何も付けず、止まらずに返る", () => {
        const sfen = "k8/9/9/9/R7R/9/9/9/4K4 b - 1";
        expect(notationOf(sfen, "1exe")).toBe("");
        expect(canMoveOnBoard(parseStudySfen(sfen).board, "1e", "0e" as Square)).toBe(false);
    });

    it("成銀と金は別の駒として数える", () => {
        const sfen = "9/3+S1G3/9/9/4k4/9/9/9/4K4 b - 1";
        expect(notationOf(sfen, "6b5a")).toBe("");
        expect(notationOf(sfen, "4b5a")).toBe("");
    });
});

const PIECE_NAMES = {
    K: ["玉", "玉"],
    R: ["飛", "竜"],
    B: ["角", "馬"],
    G: ["金", "金"],
    S: ["銀", "成銀"],
    N: ["桂", "成桂"],
    L: ["香", "成香"],
    P: ["歩", "と"],
} as const;
const RANK_KANJI = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const SQUARES = BOARD_RANKS.flatMap((rank) =>
    BOARD_FILES.map((file) => `${file}${rank}` as Square),
);

/** 移動元を書かない表記（KI2）にして、局面に照らして読み戻した手。 */
const roundTrip = (state: PositionState, from: Square, to: Square): string[] => {
    const piece = state.board[from];
    if (!piece) return [];
    const name = PIECE_NAMES[piece.type][piece.promoted ? 1 : 0];
    const square = `${to[0]}${RANK_KANJI[BOARD_RANKS.indexOf(to[1] as "a")]}`;
    const mark = state.turn === "sente" ? "▲" : "△";
    const text = `${mark}${square}${name}${relativeMoveNotation(state.board, from, to)}不成`;
    return parseKifPv(state, text, null);
};

/** 先手の駒だけを置いた盤。`pieces` は「93」のような筋・段の数字と、SFEN の駒の文字。 */
const senteBoard = (pieces: Record<string, string>) => {
    const board = parseStudySfen("9/9/9/9/9/9/9/9/9 b - 1").board;
    for (const [square, code] of Object.entries(pieces)) {
        board[usiSquare(square)] = {
            owner: "sente",
            type: code.replace("+", "") as PieceType,
            promoted: code.startsWith("+"),
        };
    }
    return board;
};
const usiSquare = (digits: string) => `${digits[0]}${BOARD_RANKS[Number(digits[1]) - 1]}` as Square;

// 日本将棋連盟「棋譜の表記方法」（https://www.shogi.or.jp/faq/kihuhyouki/）の記入例。
// [駒の配置, 移動先, { 移動元: 表記 }]
const JSA_EXAMPLES: Array<[string, Record<string, string>, string, Record<string, string>]> = [
    ["寄・引・上 A", { "93": "G", "72": "G" }, "82", { "93": "上", "72": "寄" }],
    ["寄・引・上 B", { "43": "G", "31": "G" }, "32", { "43": "上", "31": "引" }],
    ["寄・引・上 C", { "56": "G", "45": "G" }, "55", { "56": "上", "45": "寄" }],
    ["寄・引・上 D", { "89": "S", "77": "S" }, "88", { "89": "上", "77": "引" }],
    ["寄・引・上 E", { "49": "S", "27": "S" }, "38", { "49": "上", "27": "引" }],
    ["右・左1 A", { "92": "G", "72": "G" }, "81", { "92": "左", "72": "右" }],
    ["右・左1 B", { "32": "G", "12": "G" }, "22", { "32": "左", "12": "右" }],
    ["右・左1 C", { "65": "S", "45": "S" }, "56", { "65": "左", "45": "右" }],
    ["右・左1 D", { "89": "G", "79": "G" }, "78", { "89": "左", "79": "直" }],
    ["右・左1 E", { "39": "S", "29": "S" }, "38", { "39": "直", "29": "右" }],
    [
        "右・左2 A",
        { "63": "G", "53": "G", "43": "G" },
        "52",
        { "63": "左", "53": "直", "43": "右" },
    ],
    [
        "右・左2 B",
        { "79": "+P", "89": "+P", "99": "+P", "98": "+P", "87": "+P" },
        "88",
        { "79": "右", "89": "直", "99": "左上", "98": "寄", "87": "引" },
    ],
    [
        "右・左2 C",
        { "29": "S", "17": "S", "39": "S", "37": "S" },
        "28",
        { "29": "直", "17": "右", "39": "左上", "37": "左引" },
    ],
    ["竜 A", { "91": "+R", "84": "+R" }, "82", { "91": "引", "84": "上" }],
    ["竜 B", { "23": "+R", "52": "+R" }, "43", { "23": "寄", "52": "引" }],
    ["竜 C", { "55": "+R", "15": "+R" }, "35", { "55": "左", "15": "右" }],
    ["竜 D", { "99": "+R", "89": "+R" }, "88", { "99": "左", "89": "右" }],
    ["竜 E", { "28": "+R", "19": "+R" }, "17", { "28": "左", "19": "右" }],
    ["馬 A", { "91": "+B", "81": "+B" }, "82", { "91": "左", "81": "右" }],
    ["馬 B", { "95": "+B", "63": "+B" }, "85", { "95": "寄", "63": "引" }],
    ["馬 C", { "11": "+B", "34": "+B" }, "12", { "11": "引", "34": "上" }],
    ["馬 D", { "99": "+B", "59": "+B" }, "77", { "99": "左", "59": "右" }],
    ["馬 E", { "47": "+B", "18": "+B" }, "29", { "47": "左", "18": "右" }],
];

describe("日本将棋連盟の記入例", () => {
    it.each(JSA_EXAMPLES)("%s", (_name, pieces, to, expected) => {
        const board = senteBoard(pieces);
        for (const [from, notation] of Object.entries(expected)) {
            expect(relativeMoveNotation(board, usiSquare(from), usiSquare(to)), from).toBe(
                notation,
            );
        }
    });
});

describe("dropNeedsMarker", () => {
    it("盤上の同じ駒もその升へ動けるときだけ打を書く", () => {
        const board = senteBoard({ "84": "S", "62": "+S" });
        expect(dropNeedsMarker(board, "S", "sente", usiSquare("75"))).toBe(true);
        expect(dropNeedsMarker(board, "S", "sente", usiSquare("74"))).toBe(false);
        // 成銀は銀として数えない。後手の持ち駒には先手の銀は関係しない。
        expect(dropNeedsMarker(board, "S", "sente", usiSquare("51"))).toBe(false);
        expect(dropNeedsMarker(board, "S", "gote", usiSquare("75"))).toBe(false);
    });
});

describe("canPromoteOnMove", () => {
    it("敵陣に入る・敵陣の中で動く・敵陣から出る手は成れる", () => {
        const board = parseStudySfen("4k4/9/9/2S6/9/9/2s3B2/9/4K4 b - 1").board;
        expect(canPromoteOnMove(board, "7d", "7c")).toBe(true);
        expect(canPromoteOnMove(board, "7d", "7e")).toBe(false);
        // 後手の銀は 7段目以降が敵陣。
        expect(canPromoteOnMove(board, "7g", "7h")).toBe(true);
        expect(canPromoteOnMove(board, "3g", "1e")).toBe(false);
        expect(canPromoteOnMove(board, "3g", "6d")).toBe(false);
    });

    it("金・玉・成駒は成れない", () => {
        const board = parseStudySfen("4k4/9/3G1+S3/9/9/9/9/9/4K4 b - 1").board;
        expect(canPromoteOnMove(board, "6c", "6b")).toBe(false);
        expect(canPromoteOnMove(board, "4c", "4b")).toBe(false);
    });
});

describe("relativeMoveNotation と parseKifPv の往復", () => {
    it.each([
        "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
        "2+P2+P3/3+P1+P3/9/9/9/9/9/9/k7K b - 1",
        "4k4/1S7/9/SS7/9/9/9/9/4K4 b - 1",
        "k8/7+R1/8+R/9/9/9/9/9/K8 b - 1",
        "k8/9/9/9/9/4+B4/9/1+B7/K8 b - 1",
        "3g1g3/9/4k4/9/9/9/9/9/4K4 w - 1",
        "4k4/9/9/3SSS3/3S1S3/3SSS3/9/9/4K4 b - 1",
        "4k4/9/9/3GGG3/3G1G3/3GGG3/9/9/4K4 b - 1",
        "4K4/9/9/3sss3/3s1s3/3sss3/9/9/4k4 w - 1",
        "4k4/9/9/3+N+N+N3/3+N1+N3/3+N+N+N3/9/9/4K4 b - 1",
    ])("%s の盤上の手は、相対表記から元の駒に戻る", (sfen) => {
        const state = parseStudySfen(sfen);
        for (const from of SQUARES) {
            if (state.board[from]?.owner !== state.turn) continue;
            for (const to of SQUARES) {
                if (!canMoveOnBoard(state.board, from, to)) continue;
                const back = roundTrip(state, from, to);
                expect(
                    back.map((move) => move.slice(0, 4)),
                    `${from}${to}`,
                ).toEqual([`${from}${to}`]);
            }
        }
    });
});
