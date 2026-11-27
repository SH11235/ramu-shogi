import { describe, expect, it } from "vitest";
import { parseStudySfen } from "../study/sfen";
import { BOARD_FILES, BOARD_RANKS, type PositionState, type Square } from "./board";
import { canMoveOnBoard } from "./csa-move";
import { parseKifPv } from "./kif-pv";
import { relativeMoveNotation } from "./move-notation";

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

    it("上・寄・引で決まるならそれを使う（金 3 枚が 7八 へ）", () => {
        const sfen = "8k/9/9/9/9/9/2G6/3G5/2G5K b - 1";
        expect(notationOf(sfen, "7g7h")).toBe("引");
        expect(notationOf(sfen, "6h7h")).toBe("寄");
        expect(notationOf(sfen, "7i7h")).toBe("上");
    });

    it("と金: 向きで決まらなければ左右、左右だけでも決まらなければ組み合わせる", () => {
        // と金が 7一・4一・6二・4二。
        const sfen = "2+P2+P3/3+P1+P3/9/9/9/9/9/9/k7K b - 1";
        expect(notationOf(sfen, "4b5a")).toBe("右上");
        expect(notationOf(sfen, "6b5a")).toBe("左");
        expect(notationOf(sfen, "4a5a")).toBe("寄");
        // 寄でも左でも決まるときは寄。
        expect(notationOf(sfen, "7a6a")).toBe("寄");
        expect(notationOf(sfen, "6b6a")).toBe("上");
    });

    it("金がまっすぐ上がる手は直", () => {
        const sfen = "9/3GGG3/9/9/4k4/9/9/9/4K4 b - 1";
        expect(notationOf(sfen, "5b5a")).toBe("直");
        expect(notationOf(sfen, "6b5a")).toBe("左");
        expect(notationOf(sfen, "4b5a")).toBe("右");
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

    it("竜は向きで決まらなければ 2 枚の左右の位置で決める", () => {
        // 竜が 1三・2二。
        const sfen = "k8/7+R1/8+R/9/9/9/9/9/K8 b - 1";
        expect(notationOf(sfen, "1c2c")).toBe("寄");
        expect(notationOf(sfen, "2b2c")).toBe("引");
        expect(notationOf(sfen, "1c2d")).toBe("右");
        expect(notationOf(sfen, "2b2d")).toBe("左");
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
