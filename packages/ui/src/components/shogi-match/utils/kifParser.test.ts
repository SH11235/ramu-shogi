import { describe, expect, it } from "vitest";
import { parseKif, parseSfen } from "./kifParser";

const HIRATE_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

describe("parseSfen", () => {
    it("startpos を平手SFENに正規化する", () => {
        expect(parseSfen("startpos")).toEqual({ sfen: HIRATE_SFEN, moves: [] });
    });

    it("sfen キーワードを除去する", () => {
        expect(parseSfen(`sfen ${HIRATE_SFEN}`)).toEqual({ sfen: HIRATE_SFEN, moves: [] });
    });

    it("position startpos moves を分離する", () => {
        expect(parseSfen("position startpos moves 7g7f 3c3d")).toEqual({
            sfen: HIRATE_SFEN,
            moves: ["7g7f", "3c3d"],
        });
    });
});

describe("parseKif", () => {
    it("開始局面行からSFENを取得する", () => {
        const kif = [
            "#KIF version=2.0 encoding=UTF-8",
            `開始局面：sfen ${HIRATE_SFEN}`,
            "手数----指手---------消費時間--",
            "   1 ７六歩(77)",
        ].join("\n");

        const result = parseKif(kif);

        expect(result.success).toBe(true);
        expect(result.startSfen).toBe(HIRATE_SFEN);
        expect(result.moves).toEqual(["7g7f"]);
    });

    it("開始局面がstartposの場合は平手SFENに正規化する", () => {
        const kif = ["開始局面：startpos", "1 ７六歩(77)"].join("\n");
        const result = parseKif(kif);
        expect(result.success).toBe(true);
        expect(result.startSfen).toBe(HIRATE_SFEN);
    });

    it("開始局面が平手表記の場合は平手SFENに正規化する", () => {
        const kif = ["開始局面：平手", "1 ７六歩(77)"].join("\n");
        const result = parseKif(kif);
        expect(result.success).toBe(true);
        expect(result.startSfen).toBe(HIRATE_SFEN);
    });

    it("開始局面行が無い場合はundefined", () => {
        const kif = ["1 ７六歩(77)"].join("\n");
        const result = parseKif(kif);
        expect(result.success).toBe(true);
        expect(result.startSfen).toBeUndefined();
    });

    describe("成り判定", () => {
        it("成りの指し手に + を付ける", () => {
            const result = parseKif("1 ２二角成(88)");
            expect(result.moves).toEqual(["8h2b+"]);
        });

        it("不成の指し手に + を付けない", () => {
            const result = parseKif("1 ２三銀不成(34)");
            expect(result.moves).toEqual(["3d2c"]);
        });

        it("成り駒（成銀など）の移動に + を付けない", () => {
            const result = parseKif("1 ２三成銀(34)");
            expect(result.moves).toEqual(["3d2c"]);
        });

        it("「同」表記の成りに + を付ける", () => {
            const kif = ["1 ２二角成(88)", "2 同　飛成(24)"].join("\n");
            const result = parseKif(kif);
            expect(result.moves).toEqual(["8h2b+", "2d2b+"]);
        });

        it("相対表記を含む成りに + を付ける", () => {
            const result = parseKif("1 ３三銀上成(24)");
            expect(result.moves).toEqual(["2d3c+"]);
        });

        it("相対表記を含む不成に + を付けない", () => {
            const result = parseKif("1 ２三銀右不成(34)");
            expect(result.moves).toEqual(["3d2c"]);
        });

        it("相対表記のみ（成りなし）に + を付けない", () => {
            const result = parseKif("1 ５八金右(49)");
            expect(result.moves).toEqual(["4i5h"]);
        });

        it("成り駒の相対表記付き移動に + を付けない", () => {
            const result = parseKif("1 ５五馬右(66)");
            expect(result.moves).toEqual(["6f5e"]);
        });

        it("「同」表記の不成に + を付けない", () => {
            const kif = ["1 ２三銀成(34)", "2 同　銀不成(12)"].join("\n");
            const result = parseKif(kif);
            expect(result.moves).toEqual(["3d2c+", "1b2c"]);
        });
    });
});

describe("parseKif の評価値コメント", () => {
    const parseEval = (comment: string) => {
        const result = parseKif(["   1 ７六歩(77)", comment].join("\n"));
        expect(result.moves).toEqual(["7g7f"]);
        return result.moveData[0];
    };

    it("小数点の無い値はセンチポーンとして読む（いまの書き出しの形式）", () => {
        expect(parseEval("*評価値=+150 (深さ20)")).toMatchObject({ evalCp: 150, depth: 20 });
        expect(parseEval("*評価値=-80")).toMatchObject({ evalCp: -80 });
        expect(parseEval("*評価値=1234")).toMatchObject({ evalCp: 1234 });
    });

    it("0 はどちらの形式でも 0", () => {
        expect(parseEval("*評価値=+0").evalCp).toBe(0);
        expect(parseEval("*評価値=+0.0").evalCp).toBe(0);
    });

    it("小数点のある値は歩 1 枚 = 1.0 の旧形式として 100 倍する", () => {
        expect(parseEval("*評価値=+1.5 (深さ20)")).toMatchObject({ evalCp: 150, depth: 20 });
        expect(parseEval("*評価値=-0.8").evalCp).toBe(-80);
        expect(parseEval("*評価値=+12.0").evalCp).toBe(1200);
    });

    it("詰みは手数つきで読み、評価値は付けない", () => {
        expect(parseEval("*評価値=詰3手 (深さ9)")).toMatchObject({ evalMate: 3, depth: 9 });
        expect(parseEval("*評価値=被詰5手")).toMatchObject({ evalMate: -5 });
        // 手数の分からない詰み（書き出し側は「詰み」「被詰み」と書く）。
        expect(parseEval("*評価値=詰み (深さ9)")).toMatchObject({ evalMate: Infinity, depth: 9 });
        expect(parseEval("*評価値=被詰み")).toMatchObject({ evalMate: -Infinity });
        expect(parseEval("*評価値=詰3手").evalCp).toBeUndefined();
    });
});

describe("parseKif の局面図（BOD）", () => {
    const BOD = [
        "後手の持駒：角　",
        "  ９ ８ ７ ６ ５ ４ ３ ２ １",
        "+---------------------------+",
        "|v香 ・v銀v金 ・ ・ ・v桂v香|一",
        "| ・v飛 ・ ・ ・v玉v金 ・ ・|二",
        "|v歩 ・v桂v歩v歩v歩v銀v歩 ・|三",
        "| ・ ・v歩 ・ ・ ・v歩 ・v歩|四",
        "| ・v歩 ・ ・ ・ ・ ・ 歩 ・|五",
        "| ・ ・ 歩 ・ ・ 歩 歩 ・ 歩|六",
        "| 歩 歩 銀 歩 歩 ・ 桂 ・ ・|七",
        "| ・ ・ ・ ・ ・ 銀 ・ 飛 ・|八",
        "| 香 桂 ・ 金 玉 金 ・ ・ 香|九",
        "+---------------------------+",
        "先手の持駒：角　",
    ];

    it("局面図を開始局面にし、成る手（香成）も読む", () => {
        const result = parseKif(
            [
                "開始日時：2026/11/06 18:53:43",
                ...BOD,
                "手数----指手---------消費時間--",
                "   1 ▲７八金(69)   ( 0:07/00:00:07)",
                "*info",
                "**評価値=+50",
                "   2 △６二銀(71)   ( 0:00/00:00:00)",
                "   3 ▲１一香成(15)   ( 0:01/00:00:08)",
                "   4 投了",
                "",
                "まで3手で先手の勝ち",
            ].join("\n"),
        );
        expect(result.success).toBe(true);
        expect(result.startSfen).toBe(
            "l1sg3nl/1r3kg2/p1npppsp1/2p3p1p/1p5P1/2P2PP1P/PPSPP1N2/5S1R1/LN1GKG2L b Bb 1",
        );
        expect(result.moves).toEqual(["6i7h", "7a6b", "1e1a+"]);
    });

    it("手合割より局面図を優先し、後手番・手数・持ち駒の枚数を読む", () => {
        const result = parseKif(
            [
                "手合割：平手",
                ...BOD.slice(0, -1),
                "先手の持駒：飛　歩十二　",
                "後手番",
                "手数＝22",
                "手数----指手---------消費時間--",
            ].join("\n"),
        );
        expect(result.startSfen).toBe(
            "l1sg3nl/1r3kg2/p1npppsp1/2p3p1p/1p5P1/2P2PP1P/PPSPP1N2/5S1R1/LN1GKG2L w R12Pb 23",
        );
    });

    it("段の欠けた局面図は断る", () => {
        const result = parseKif(
            [...BOD.slice(0, 5), "先手の持駒：なし", "1 ７六歩(77)"].join("\n"),
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain("局面図");
    });
});

describe("parseKif の局面図（BOD）の崩れた入力", () => {
    const board = [
        "+---------------------------+",
        "| ・ ・ ・ ・v玉 ・ ・ ・ ・|一",
        ...["二", "三", "四", "五", "六", "七", "八"].map(
            (rank) => `| ・ ・ ・ ・ ・ ・ ・ ・ ・|${rank}`,
        ),
        "| ・ ・ ・ ・ 玉 ・ ・ ・ ・|九",
        "+---------------------------+",
    ];

    it("盤の無い持ち駒の行だけの見出しは、局面図として読まない", () => {
        const result = parseKif(["先手の持駒：なし", "手合割：平手", "1 ７六歩(77)"].join("\n"));
        expect(result.success).toBe(true);
        expect(result.startSfen).toBe("startpos");
    });

    it("持ち駒の枚数を算用数字で書いたものも読む", () => {
        const result = parseKif(
            ["後手の持駒：歩２　", ...board, "先手の持駒：歩10", "1 ５八玉(59)"].join("\n"),
        );
        expect(result.startSfen).toBe("4k4/9/9/9/9/9/9/9/4K4 b 10P2p 1");
    });

    it("指し手の区切り行が無くても、盤のあとの行を局面図として読まない", () => {
        const result = parseKif(
            [
                "後手の持駒：なし",
                ...board,
                "先手の持駒：なし",
                "1 ５八玉(59)",
                "先手の持駒：金",
            ].join("\n"),
        );
        expect(result.startSfen).toBe("4k4/9/9/9/9/9/9/9/4K4 b - 1");
        expect(result.moves).toEqual(["5i5h"]);
    });
});

describe("parseKif の局面図（BOD）と見出し・指し手の並び", () => {
    const board = [
        "+---------------------------+",
        "| ・ ・ ・ ・v玉 ・ ・ ・ ・|一",
        ...["二", "三", "四", "五", "六", "七", "八"].map(
            (rank) => `| ・ ・ ・ ・ ・ ・ ・ ・ ・|${rank}`,
        ),
        "| ・ ・ ・ ・ 玉 ・ ・ ・ ・|九",
        "+---------------------------+",
    ];

    it("盤のあとに見出しがあっても、指し手の前の後手番を読む", () => {
        const result = parseKif(
            [
                "後手の持駒：なし",
                ...board,
                "先手の持駒：金",
                "先手：A",
                "後手：B",
                "後手番",
                "手数----指手--",
                "1 △５二玉(51)",
            ].join("\n"),
        );
        expect(result.startSfen).toBe("4k4/9/9/9/9/9/9/9/4K4 w G 1");
        expect(result.moves).toEqual(["5a5b"]);
    });

    it("指し手のあとに書かれた局面図は開始局面にしない", () => {
        const result = parseKif(
            [
                "手合割：平手",
                "手数----指手--",
                "1 ７六歩(77)",
                "まで1手で中断",
                "後手の持駒：なし",
                ...board,
                "先手の持駒：なし",
            ].join("\n"),
        );
        expect(result.startSfen).toBe("startpos");
        expect(result.moves).toEqual(["7g7f"]);
    });

    it("持ち駒の枚数 0 は読めない欄として断る", () => {
        const result = parseKif(
            ["後手の持駒：歩0", ...board, "先手の持駒：なし", "1 ５八玉(59)"].join("\n"),
        );
        expect(result.success).toBe(false);
    });
});

describe("parseKif の局面図（BOD）の筋の番号", () => {
    it("半角で書いた筋の番号の行があっても、局面図を読む", () => {
        const result = parseKif(
            [
                "後手の持駒：なし",
                "  9  8  7  6  5  4  3  2  1",
                "+---------------------------+",
                "| ・ ・ ・ ・v玉 ・ ・ ・ ・|一",
                ...["二", "三", "四", "五", "六", "七", "八"].map(
                    (rank) => `| ・ ・ ・ ・ ・ ・ ・ ・ ・|${rank}`,
                ),
                "| ・ ・ ・ ・ 玉 ・ ・ ・ ・|九",
                "+---------------------------+",
                "先手の持駒：なし",
                "1 ５八玉(59)",
            ].join("\n"),
        );
        expect(result.startSfen).toBe("4k4/9/9/9/9/9/9/9/4K4 b - 1");
    });
});

describe("parseKif の区切り行の無い KIF と局面図", () => {
    it("半角の筋や番号の無い指し手のあとの局面図を開始局面にしない", () => {
        const board = [
            "後手の持駒：なし",
            "| ・ ・ ・ ・v玉 ・ ・ ・ ・|一",
            ...["二", "三", "四", "五", "六", "七", "八"].map(
                (rank) => `| ・ ・ ・ ・ ・ ・ ・ ・ ・|${rank}`,
            ),
            "| ・ ・ ・ ・ 玉 ・ ・ ・ ・|九",
            "先手の持駒：なし",
        ];
        for (const first of ["1 7六歩(77)", "７六歩(77)"]) {
            const result = parseKif(["手合割：平手", first, ...board].join("\n"));
            expect(result.startSfen).toBe("startpos");
            expect(result.moves).toEqual(["7g7f"]);
        }
    });
});
