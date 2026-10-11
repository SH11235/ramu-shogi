import { describe, expect, it, vi } from "vitest";
import { MATE_WITHOUT_PLY } from "./kifFormat";
import {
    csaAnnotationsToMoveData,
    decodeKifuFileBytes,
    detectKifuTextFormat,
    importKifuText,
} from "./kifuImport";

const HIRATE_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const CSA_TEXT = [
    "V2.2",
    "N+A",
    "N-B",
    "PI",
    "+",
    "+7776FU,T4",
    "'** 45 -3334FU",
    "-3334FU,T7",
    "'** 100000",
    "%TORYO",
].join("\n");

// 角換わりの途中局面: 双方が角を 1 枚ずつ持ち、後手番。
const MIDGAME_POSITION = [
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
const MIDGAME_SFEN = "ln1gk1snl/1r4g2/p1ppppspp/6p2/1p5P1/2P6/PPSPPPP1P/2G4R1/LN2KGSNL w Bb 1";

const KIF_TEXT = [
    "#KIF version=2.0 encoding=UTF-8",
    "手合割：平手",
    "手数----指手---------消費時間--",
    "   1 ７六歩(77)   ( 0:01/00:00:01)",
    "   2 ３四歩(33)   ( 0:02/00:00:02)",
].join("\n");

// 「手合割：平手\n1 ７六歩(77)\n」を Shift_JIS で符号化したバイト列。
const SJIS_KIF_BYTES = new Uint8Array([
    0x8e, 0xe8, 0x8d, 0x87, 0x8a, 0x84, 0x81, 0x46, 0x95, 0xbd, 0x8e, 0xe8, 0x0a, 0x31, 0x20, 0x82,
    0x56, 0x98, 0x5a, 0x95, 0xe0, 0x28, 0x37, 0x37, 0x29, 0x0a,
]);

describe("detectKifuTextFormat", () => {
    it("CSA を指し手行で判別する (CRLF でも)", () => {
        expect(detectKifuTextFormat(CSA_TEXT)).toBe("csa");
        expect(detectKifuTextFormat(CSA_TEXT.replace(/\n/g, "\r\n"))).toBe("csa");
        expect(detectKifuTextFormat("+7776FU\nT3\n-3334FU\nT2")).toBe("csa");
    });

    it("指し手の無い CSA はヘッダーで判別する", () => {
        expect(detectKifuTextFormat("V2.2\nN+A\nN-B\nPI\n+\n%CHUDAN")).toBe("csa");
    });

    it("指し手も V 行も無い CSA は局面の行で判別する", () => {
        // PI (駒落ち指定つきを含む)
        expect(detectKifuTextFormat("PI82HI22KA\n-\n%CHUDAN")).toBe("csa");
        expect(detectKifuTextFormat("PI\n+")).toBe("csa");
        // P+ / P- の駒別表現 (持ち駒・00AL を含む)
        expect(detectKifuTextFormat("P-51OU\nP+53FU00KI\n+")).toBe("csa");
        expect(detectKifuTextFormat("P-51OU\nP+53FU\nP-00AL\n+")).toBe("csa");
        // P1〜P9 の一括表現 (行末の空白が落ちていてもよい、CRLF でもよい)
        expect(detectKifuTextFormat(MIDGAME_POSITION.join("\n"))).toBe("csa");
        expect(
            detectKifuTextFormat(MIDGAME_POSITION.map((row) => row.trimEnd()).join("\r\n")),
        ).toBe("csa");
    });

    it("SFEN や KIF を CSA と取り違えない", () => {
        const sfenInputs = [
            "startpos",
            "startpos moves 7g7f 3c3d",
            "position startpos moves 7g7f",
            "sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
            "position sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1 moves 7g7f",
            // 先頭が P で始まる盤面 (SFEN は `/` で区切る)
            "P8/9/9/9/4k4/9/9/9/4K4 b - 1",
            "PI4k3/9/9/9/9/9/9/9/4K4 b - 1",
            "7g7f 3c3d",
            "P*5e",
        ];
        for (const input of sfenInputs) {
            expect(detectKifuTextFormat(input)).toBe("sfen");
        }
        // 行頭が P で始まる英語の行があっても、KIF は日本語ヘッダーで KIF と判別する。
        expect(detectKifuTextFormat(`${KIF_TEXT}\nPI`)).toBe("kif");
        expect(detectKifuTextFormat("手合割：平手\nPlayer memo\n1 ７六歩(77)")).toBe("kif");
        // 文の途中に PI や P1 があるだけでは CSA にしない。
        expect(detectKifuTextFormat("PIECE 7g7f")).toBe("sfen");
        expect(detectKifuTextFormat("P1 player")).toBe("sfen");
    });

    it("KIF と SFEN は従来どおり判別する", () => {
        expect(detectKifuTextFormat(KIF_TEXT)).toBe("kif");
        expect(detectKifuTextFormat("1 ７六歩(77)\n2 ３四歩(33)")).toBe("kif");
        expect(detectKifuTextFormat("startpos moves 7g7f 3c3d")).toBe("sfen");
        expect(
            detectKifuTextFormat("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1"),
        ).toBe("sfen");
    });
});

describe("csaAnnotationsToMoveData", () => {
    it("詰みを手数不明の詰み (±Infinity) に直し、欠損は undefined のままにする", () => {
        expect(
            csaAnnotationsToMoveData([
                { elapsedMs: 1000, evalCp: 30, pv: ["3c3d"] },
                undefined,
                { mateWinner: "sente" },
                { elapsedMs: 0, mateWinner: "gote" },
            ]),
        ).toEqual([
            { elapsedMs: 1000, evalCp: 30, pv: ["3c3d"] },
            undefined,
            { evalMate: MATE_WITHOUT_PLY },
            { elapsedMs: 0, evalMate: -MATE_WITHOUT_PLY },
        ]);
    });
});

describe("importKifuText", () => {
    const createHandlers = () => ({
        onImportSfen: vi.fn(async (..._args: unknown[]) => {}),
        onImportKif: vi.fn(async (..._args: unknown[]) => {}),
    });

    it("CSA は平手から読み込み、評価値・読み筋・消費時間を一緒に渡す", async () => {
        const handlers = createHandlers();
        await importKifuText(CSA_TEXT, handlers);

        expect(handlers.onImportSfen).toHaveBeenCalledWith("startpos", ["7g7f", "3c3d"], {
            moveData: [
                { elapsedMs: 4000, evalCp: 45, pv: ["3c3d"] },
                { elapsedMs: 7000, evalMate: MATE_WITHOUT_PLY },
            ],
        });
        expect(handlers.onImportKif).not.toHaveBeenCalled();
    });

    it("途中局面・後手番開始の CSA は、その局面の SFEN から読み込む", async () => {
        const handlers = createHandlers();
        await importKifuText(
            [...MIDGAME_POSITION, "-", "-0055KA,T3", "'** -35 +2524FU", "+2524FU,T4"].join("\n"),
            handlers,
        );

        expect(handlers.onImportSfen).toHaveBeenCalledWith(MIDGAME_SFEN, ["B*5e", "2e2d"], {
            moveData: [{ elapsedMs: 3000, evalCp: -35, pv: ["2e2d"] }, { elapsedMs: 4000 }],
        });
    });

    it("旧 csa_client 形式 (指し手の前の `'*`) は、その指し手の評価値として読み込む", async () => {
        const handlers = createHandlers();
        await importKifuText(
            [
                "V2.2",
                "N+RAMU",
                "N-Opponent",
                "PI",
                "+",
                "'* 30 +7776FU -3334FU",
                "+7776FU",
                "T3",
                "'* -50 -3334FU +2726FU",
                "-3334FU",
                "T5",
                "%TORYO",
            ].join("\n"),
            handlers,
        );

        expect(handlers.onImportSfen).toHaveBeenCalledWith("startpos", ["7g7f", "3c3d"], {
            moveData: [
                { elapsedMs: 3000, evalCp: 30, pv: ["3c3d"] },
                { elapsedMs: 5000, evalCp: -50, pv: ["2g2f"] },
            ],
        });
    });

    it("指せない手を含む CSA は行番号つきで失敗する", async () => {
        const handlers = createHandlers();
        await expect(importKifuText("PI\n+\n+7776FU\n-3334FU\n+7771FU", handlers)).rejects.toThrow(
            /CSA の解析に失敗しました: 5 行目の指し手を適用できません/,
        );
        expect(handlers.onImportSfen).not.toHaveBeenCalled();
    });

    it("指し手の無い CSA の局面を貼っても、その局面を読み込む", async () => {
        const handlers = createHandlers();
        await importKifuText("PI82HI22KA\n-\n%CHUDAN", handlers);

        expect(handlers.onImportSfen).toHaveBeenCalledWith(
            "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
            [],
            { moveData: [] },
        );
    });

    it("KIF と SFEN は従来のコールバックへ渡す", async () => {
        const handlers = createHandlers();
        await importKifuText(KIF_TEXT, handlers);
        expect(handlers.onImportKif).toHaveBeenCalledTimes(1);
        expect(handlers.onImportKif.mock.calls[0]?.[0]).toEqual(["7g7f", "3c3d"]);

        await importKifuText("startpos moves 7g7f 3c3d", handlers);
        expect(handlers.onImportSfen).toHaveBeenCalledWith(HIRATE_SFEN, ["7g7f", "3c3d"]);
    });

    it("空の入力・壊れた CSA・解釈できない局面の CSA は利用者向けの文言で失敗する", async () => {
        const handlers = createHandlers();
        await expect(importKifuText("  \n", handlers)).rejects.toThrow("入力が空です");
        await expect(importKifuText("PI\n+\n+7776FU\n+7775FU", handlers)).rejects.toThrow(
            /CSA の解析に失敗しました/,
        );
        await expect(importKifuText("V2\nP-51OU\nP+5XFU\n+\n+5352FU", handlers)).rejects.toThrow(
            /CSA の開始局面を解釈できません/,
        );
        expect(handlers.onImportSfen).not.toHaveBeenCalled();
        expect(handlers.onImportKif).not.toHaveBeenCalled();
    });
});

describe("decodeKifuFileBytes", () => {
    it("UTF-8 はそのまま読み、BOM を落とす", () => {
        const text = "手合割：平手\n+7776FU";
        expect(decodeKifuFileBytes(new TextEncoder().encode(text))).toBe(text);
        const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
        expect(decodeKifuFileBytes(withBom)).toBe(text);
    });

    it("UTF-8 として読めないバイト列は Shift_JIS として読む", () => {
        expect(decodeKifuFileBytes(SJIS_KIF_BYTES)).toBe("手合割：平手\n1 ７六歩(77)\n");
        expect(decodeKifuFileBytes(SJIS_KIF_BYTES.buffer)).toBe("手合割：平手\n1 ７六歩(77)\n");
    });

    it("ASCII だけの CSA はどちらの文字コードでも同じ結果になる", () => {
        expect(decodeKifuFileBytes(new TextEncoder().encode(CSA_TEXT))).toBe(CSA_TEXT);
    });
});
