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
