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

    it("指し手の無い棋譜・空の入力・パスを含む棋譜は、理由つきで断る", () => {
        expect(() => parseKifuTextForStudy("   ")).toThrow("入力が空です");
        expect(() => parseKifuTextForStudy("startpos")).toThrow("指し手がありません");
        expect(() => parseKifuTextForStudy("startpos moves 7g7f pass")).toThrow(
            "研究ノートにできない手",
        );
    });
});
