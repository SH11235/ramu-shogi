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
        // 局面の行は、字下げやカンマ区切りでも読む（CSA の解析と同じ）。
        for (const csa of [
            "V2.2\n PI\n+",
            "V2.2\nN+a\nN-b\n+,PI",
            "V2.2\n$EVENT:test\nPI\n+\n'comment\n%TORYO",
        ]) {
            expect(parseKifuTextForStudy(csa)).toMatchObject({ kind: "moves", moves: [] });
        }
        const sfen = "4k4/9/9/9/9/9/9/9/4K4 b G 1";
        // 見出し・コメント・区切りの行があっても、指し手の行が無ければ局面だけ。
        for (const kif of [
            `開始局面：${sfen}`,
            `#KIF version=2.0\n開始日時：2026/10/12 10:00\n開始局面：${sfen}\n*1 手目が大事\n手数----指手---------消費時間--\nまで0手で中断`,
        ]) {
            expect(parseKifuTextForStudy(kif)).toEqual({
                kind: "moves",
                startSfen: sfen,
                moves: [],
            });
        }
    });

    it("指し手の行があるのに読めなかった棋譜・見出しだけの棋譜は、局面だけの材料にしない", () => {
        // KIF: 指し手の行が 1 つも読めない（移動元が無い）。
        expect(() => parseKifuTextForStudy("開始局面：startpos\n1 ７六歩\n2 ３四歩")).toThrow(
            "パースできる指し手が見つかりませんでした",
        );
        // KIF: 全角の手数、「1.」の形、手数の無い行も、指し手の行として扱う。
        for (const body of [
            "１ ７六歩(77)\n２ ３四歩(33)",
            "1.７六歩\n2.３四歩",
            "７六歩\n３四歩",
        ]) {
            expect(() => parseKifuTextForStudy(`開始局面：startpos\n${body}`)).toThrow(
                "パースできる指し手が見つかりませんでした",
            );
        }
        // KIF: 見出しだけ（開始局面の明示なし）。
        expect(() => parseKifuTextForStudy("手合割：平手\n先手：a\n後手：b")).toThrow(
            "パースできる指し手が見つかりませんでした",
        );
        // KIF: 消費時間つきの指し手の行（コロンを含む）、開始局面の行に続けて書いた手順。
        for (const body of ["同歩(77)(0:05/00:00:05)", "▽３四歩(33)(0:01/00:00:01)"]) {
            expect(() => parseKifuTextForStudy(`開始局面：startpos\n${body}`)).toThrow(
                "パースできる指し手が見つかりませんでした",
            );
        }
        expect(() => parseKifuTextForStudy("開始局面：startpos moves 7g7f 3c3d")).toThrow(
            "パースできる指し手が見つかりませんでした",
        );
        // KIF: 開始局面の行や、見出しの形をした行に書かれた指し手。
        for (const kif of [
            "開始局面：平手 ▲７六歩(77) △３四歩(33)",
            "開始局面：startpos\n指し手：▲７六歩(77)",
            "開始局面：startpos\n手順：7g7f 3c3d",
            "開始局面：startpos\n手数1 ７六歩(77)",
            "開始局面：startpos\nまで1手 ７六歩(77)",
            "開始局面：lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 7g7f",
        ]) {
            expect(() => parseKifuTextForStudy(kif), kif).toThrow();
        }
        // SFEN: 手数の欄に入った指し手。
        for (const sfen of [
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 7g7f",
            "sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 7g7f",
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -\n7g7f",
        ]) {
            expect(() => parseKifuTextForStudy(sfen), sfen).toThrow(
                "棋譜の形式を判別できませんでした",
            );
        }
        // CSA: 終局の指示に続けて書いた指し手。
        expect(() => parseKifuTextForStudy("PI\n+\n%TORYO +7776FU -3334FU")).toThrow(
            "CSA の解析に失敗しました: 指し手を読み取れませんでした",
        );
        // CSA: 見出しだけ（局面の行なし）、読めない指し手の行、終局の指示や区切りのあとの指し手、
        // コメントの中の `PI`。
        for (const csa of [
            "V2.2\nN+a\nN-b",
            "PI\n+\n7776FU\n3334FU",
            "PI\n+\n1 +7776FU",
            "PI\n+\n7g7f",
            "PI\n+\n＋7776FU",
            "PI\n+\n%TORYO\n+7776FU",
            "/\nPI\n+\n+7776FU",
            "V2.2\n+,'comment,PI",
        ]) {
            expect(() => parseKifuTextForStudy(csa), csa).toThrow(
                "CSA の解析に失敗しました: 指し手を読み取れませんでした",
            );
        }
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
