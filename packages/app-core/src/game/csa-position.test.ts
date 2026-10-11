import { describe, expect, it } from "vitest";
import { buildCsaStartPosition, parseCsaStartPosition } from "./csa-position";

const HIRATE_ROWS = [
    "P1-KY-KE-GI-KI-OU-KI-GI-KE-KY",
    "P2 * -HI *  *  *  *  * -KA * ",
    "P3-FU-FU-FU-FU-FU-FU-FU-FU-FU",
    "P4 *  *  *  *  *  *  *  *  * ",
    "P5 *  *  *  *  *  *  *  *  * ",
    "P6 *  *  *  *  *  *  *  *  * ",
    "P7+FU+FU+FU+FU+FU+FU+FU+FU+FU",
    "P8 * +KA *  *  *  *  * +HI * ",
    "P9+KY+KE+GI+KI+OU+KI+GI+KE+KY",
];

const HIRATE_BOARD = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL";

// 角換わりの途中局面: 双方が角を 1 枚ずつ持ち、後手番。
const MIDGAME_ROWS = [
    "P1-KY-KE * -KI-OU * -GI-KE-KY",
    "P2 * -HI *  *  *  * -KI *  * ",
    "P3-FU * -FU-FU-FU-FU-GI-FU-FU",
    "P4 *  *  *  *  *  * -FU *  * ",
    "P5 * -FU *  *  *  *  * +FU * ",
    "P6 *  * +FU *  *  *  *  *  * ",
    "P7+FU+FU+GI+FU+FU+FU+FU * +FU",
    "P8 *  * +KI *  *  *  * +HI * ",
    "P9+KY+KE *  * +OU+KI+GI+KE+KY",
    "P+00KA",
    "P-00KA",
];
const MIDGAME_BOARD = "ln1gk1snl/1r4g2/p1ppppspp/6p2/1p5P1/2P6/PPSPPPP1P/2G4R1/LN2KGSNL";

describe("parseCsaStartPosition", () => {
    it("PI と手番行だけの平手は startpos", () => {
        const start = parseCsaStartPosition("V2.2\nN+A\nN-B\nPI\n+\n+7776FU");
        expect(start.sfen).toBe("startpos");
        expect(start.position.turn).toBe("sente");
        expect(start.position.board["7g"]).toEqual({ owner: "sente", type: "P" });
    });

    it("P1〜P9 で書かれた平手も startpos (行末の空白が落ちていてもよい)", () => {
        expect(parseCsaStartPosition([...HIRATE_ROWS, "+", "+7776FU"].join("\n")).sfen).toBe(
            "startpos",
        );
        const trimmed = HIRATE_ROWS.map((row) => row.trimEnd());
        expect(parseCsaStartPosition([...trimmed, "+"].join("\r\n")).sfen).toBe("startpos");
    });

    it("局面の行が無ければ平手とみなす", () => {
        expect(parseCsaStartPosition("+\n+7776FU").sfen).toBe("startpos");
        expect(parseCsaStartPosition("").sfen).toBe("startpos");
    });

    it("平手でも後手番から始まるなら SFEN で返す", () => {
        const start = parseCsaStartPosition("PI\n-\n-3334FU");
        expect(start.sfen).toBe(`${HIRATE_BOARD} w - 1`);
        expect(start.position.turn).toBe("gote");
    });

    it("PI の駒落ち指定 (二枚落ち) を読む", () => {
        const start = parseCsaStartPosition("PI82HI22KA\n-\n-3334FU");
        expect(start.sfen).toBe("lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1");
        expect(start.position.board["8b"]).toBeNull();
        expect(start.position.board["2b"]).toBeNull();
    });

    it("P1〜P9 の駒落ち (香落ち) を読む", () => {
        const rows = [...HIRATE_ROWS];
        rows[0] = "P1-KY-KE-GI-KI-OU-KI-GI-KE * ";
        expect(parseCsaStartPosition([...rows, "-"].join("\n")).sfen).toBe(
            "lnsgkgsn1/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        );
    });

    it("途中局面・持ち駒あり・後手番開始を読む", () => {
        const start = parseCsaStartPosition([...MIDGAME_ROWS, "-", "-0055KA", "T3"].join("\n"));
        expect(start.sfen).toBe(`${MIDGAME_BOARD} w Bb 1`);
        expect(start.position.turn).toBe("gote");
        expect(start.position.hands).toEqual({ sente: { B: 1 }, gote: { B: 1 } });
    });

    it("持ち駒は SFEN の順 (飛角金銀桂香歩、先手が先) で、複数枚は枚数を付ける", () => {
        const start = parseCsaStartPosition(
            [
                ...MIDGAME_ROWS.slice(0, 9),
                "P+00FU00FU00KA00FU",
                "P+00HI",
                "P-00KE00KI00KE",
                "+",
            ].join("\n"),
        );
        expect(start.sfen).toBe(`${MIDGAME_BOARD} b RB3Pg2n 1`);
    });

    it("成り駒を読む", () => {
        const rows = [...HIRATE_ROWS];
        rows[1] = "P2 * -HI *  *  *  *  * +UM * ";
        rows[7] = "P8 *  *  *  *  *  *  * +HI * ";
        rows[6] = "P7+FU+FU+FU+FU+FU+FU+FU+FU-TO";
        const start = parseCsaStartPosition([...rows, "P-00KA", "-"].join("\n"));
        expect(start.sfen).toBe("lnsgkgsnl/1r5+B1/ppppppppp/9/9/9/PPPPPPPP+p/7R1/LNSGKGSNL w b 1");
        expect(start.position.board["2b"]).toEqual({ owner: "sente", type: "B", promoted: true });
    });

    it("P+ / P- の駒別表現だけで書かれた局面 (詰将棋など) を読む", () => {
        const start = parseCsaStartPosition("P-51OU\nP+53FU00KI\n+");
        expect(start.sfen).toBe("4k4/9/4P4/9/9/9/9/9/9 b G 1");
    });

    it("PI に駒別表現を足した局面を読む", () => {
        const start = parseCsaStartPosition("PI22KA88KA\nP+00KA\nP-00KA\n+");
        expect(start.sfen).toBe("lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/7R1/LNSGKGSNL b Bb 1");
    });

    it("最初の指し手より後ろの行は局面に使わない", () => {
        expect(parseCsaStartPosition("PI\n+\n+7776FU\nP+00KA").sfen).toBe("startpos");
    });
});

describe("parseCsaStartPosition: 00AL (残りの駒をすべて持ち駒にする)", () => {
    it("盤上に無い残りの駒 (玉を除く) をすべてその側の持ち駒にする", () => {
        // 詰将棋の定番: 攻め方は盤上の歩だけ、残りはすべて玉方の持ち駒。
        const start = parseCsaStartPosition("P-51OU\nP+53FU\nP-00AL\n+");
        expect(start.sfen).toBe("4k4/9/4P4/9/9/9/9/9/9 b 2r2b4g4s4n4l17p 1");
        expect(start.position.hands).toEqual({
            sente: {},
            gote: { R: 2, B: 2, G: 4, S: 4, N: 4, L: 4, P: 17 },
        });
    });

    it("相手の持ち駒と、同じ側が先に持っている駒は残りから除く", () => {
        const start = parseCsaStartPosition("P-51OU\nP+53FU\nP-00KI00KI\nP+00HI\nP+00AL\n+");
        expect(start.sfen).toBe("4k4/9/4P4/9/9/9/9/9/9 b 2R2B2G4S4N4L17P2g 1");
    });

    it("盤上の成り駒は元の駒として数え、行の途中に書かれた 00AL も最後に配る", () => {
        const start = parseCsaStartPosition("P+00AL\nP-51OU\nP+53TO52RY\nP-41UM\n-");
        expect(start.sfen).toBe("4k+b3/4+R4/4+P4/9/9/9/9/9/9 w RB4G4S4N4L17P 1");
    });

    it("平手の盤に 00AL を書いても配る駒は無い", () => {
        expect(parseCsaStartPosition("PI\nP+00AL\n+").sfen).toBe("startpos");
    });
});

describe("parseCsaStartPosition: 解釈できない局面記述", () => {
    const expectInvalid = (csa: string) =>
        expect(() => parseCsaStartPosition(csa)).toThrow(/CSA の開始局面を解釈できません/);

    it("00AL を両方の側に書いた局面、駒が 1 組を超える局面を弾く", () => {
        expectInvalid("P-51OU\nP+53FU\nP+00AL\nP-00AL\n+");
        expectInvalid("P-51OU\nP+11KA12KA13KA\nP-00AL\n+");
    });

    it("知らない駒・マス・持ち駒にできない駒を弾く", () => {
        const rows = [...HIRATE_ROWS];
        rows[4] = "P5 *  *  *  * +XX *  *  *  * ";
        expectInvalid([...rows, "+"].join("\n"));
        expectInvalid("PI\nP+00OU\n+");
        expectInvalid("PI\nP+00TO\n+");
        expectInvalid("P+5XFU\n+");
        expectInvalid("P+55ZZ\n+");
        expectInvalid("P+55F\n+");
    });

    it("段の欠け・重複・はみ出しを弾く", () => {
        expectInvalid([...HIRATE_ROWS.slice(0, 8), "+"].join("\n"));
        expectInvalid([...HIRATE_ROWS, HIRATE_ROWS[0], "+"].join("\n"));
        const rows = [...HIRATE_ROWS];
        rows[3] = "P4 *  *  *  *  *  *  *  *  *  * ";
        expectInvalid([...rows, "+"].join("\n"));
    });

    it("同じマスへの重複配置、平手に無い駒の駒落ち指定、PI と P1〜P9 の併用を弾く", () => {
        expectInvalid("PI\nP+77FU\n+");
        expectInvalid("PI55HI\n+");
        expectInvalid("PI82KA\n+");
        expectInvalid(["PI", ...HIRATE_ROWS, "+"].join("\n"));
    });
});

describe("buildCsaStartPosition", () => {
    it("手番を省くと先手番", () => {
        expect(buildCsaStartPosition(["PI"]).sfen).toBe("startpos");
        expect(buildCsaStartPosition(["PI"], "gote").sfen).toBe(`${HIRATE_BOARD} w - 1`);
    });
});
