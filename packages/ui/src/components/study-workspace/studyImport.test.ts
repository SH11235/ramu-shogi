import { describe, expect, it } from "vitest";
import { parseKifuTextForStudy } from "./studyImport";

const CSA_TEXT = ["V2.2", "N+先手", "N-後手", "PI", "+", "+7776FU,T4", "-3334FU,T7"].join("\n");

describe("parseKifuTextForStudy", () => {
    it("CSA は全文をそのまま材料にする（対局者名・評価値ごと取り込めるように）", () => {
        expect(parseKifuTextForStudy(CSA_TEXT)).toEqual({ kind: "csa", csa: CSA_TEXT });
    });

    it("SFEN は開始局面と手順にする", () => {
        expect(parseKifuTextForStudy("startpos moves 7g7f 3c3d")).toEqual({
            kind: "moves",
            startSfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
            moves: ["7g7f", "3c3d"],
        });
    });

    it("KIF は手順と、付いていた消費時間を取り込む", () => {
        const source = parseKifuTextForStudy(
            [
                "手合割：平手",
                "手数----指手---------消費時間--",
                "1 ７六歩(77) ( 0:05/00:00:05)",
            ].join("\n"),
        );
        expect(source.kind).toBe("moves");
        if (source.kind !== "moves") return;
        expect(source.moves).toEqual(["7g7f"]);
        expect(source.sourceKind).toBe("kif");
        expect(source.annotations?.[0]?.elapsedMs).toBe(5000);
    });

    it("指し手の無い入力（局面だけ）は、その局面から始めるノートの材料にする", () => {
        expect(parseKifuTextForStudy("startpos")).toEqual({
            kind: "moves",
            startSfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
            moves: [],
        });
        const sfen = "4k4/9/9/9/9/9/9/9/4K4 b G 1";
        expect(parseKifuTextForStudy(`sfen ${sfen}`)).toEqual({
            kind: "moves",
            startSfen: sfen,
            moves: [],
        });
    });

    it("指し手の無い CSA・開始局面だけの KIF も、局面だけの材料にする", () => {
        expect(parseKifuTextForStudy("V2.2\nN+a\nN-b\nPI\n+")).toEqual({
            kind: "moves",
            startSfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
            moves: [],
        });
        const sfen = "4k4/9/9/9/9/9/9/9/4K4 b G 1";
        expect(parseKifuTextForStudy(`開始局面：${sfen}`)).toEqual({
            kind: "moves",
            startSfen: sfen,
            moves: [],
        });
    });

    it("指し手が無く、局面として成り立たない入力は断る", () => {
        // 玉が無い。
        expect(() => parseKifuTextForStudy("sfen 9/9/9/9/9/9/9/9/4K4 b - 1")).toThrow(
            "この局面は研究ノートにできません: 後手の玉が盤上にありません",
        );
        expect(() => parseKifuTextForStudy("P+55FU\n+")).toThrow(
            "この局面は研究ノートにできません",
        );
        // 歩が一組（18 枚）を超える。
        expect(() => parseKifuTextForStudy("sfen 4k4/9/9/9/9/9/9/9/4K4 b 19P 1")).toThrow(
            "この局面は研究ノートにできません",
        );
        // SFEN の形をしていない、数語のテキスト。
        for (const text of ["hello world foo", "a b c d"]) {
            expect(() => parseKifuTextForStudy(text)).toThrow("棋譜の形式を判別できませんでした");
        }
    });

    it("空の入力・棋譜でない入力・パスを含む棋譜は、理由つきで断る", () => {
        expect(() => parseKifuTextForStudy("   ")).toThrow("入力が空です");
        expect(() => parseKifuTextForStudy("こんにちは")).toThrow(
            "棋譜の形式を判別できませんでした（CSA / KIF / SFEN に対応）",
        );
        expect(() => parseKifuTextForStudy("startpos moves 7g7f pass")).toThrow(
            "研究ノートにできない手",
        );
    });
});
