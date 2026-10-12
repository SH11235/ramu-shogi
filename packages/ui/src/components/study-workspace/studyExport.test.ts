import { applyStudyOps, createStudyDocumentFromMoves } from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import { cp, createTestStudy, TEST_LAYER_ID } from "./study-test-support";
import { exportStudyLineToKif, exportStudyPositionToSfen } from "./studyExport";
import { parseKifuTextForStudy } from "./studyImport";
import { buildStudyViewTree, resolveStudyLine } from "./studyView";

describe("exportStudyLineToKif", () => {
    it("表示中の手順を、対局者名・評価値・コメントつきの KIF にする（取り込み直すと同じ手順になる）", () => {
        const base = createTestStudy([cp(0), cp(30), cp(-20), null, null]);
        const doc = applyStudyOps(base.doc, [
            { type: "setComment", nodeId: base.ids[0], value: "開始局面のメモ" },
            { type: "setComment", nodeId: base.ids[2], value: "角道を開ける\n2 行目" },
        ]);
        const { tree } = buildStudyViewTree(doc, TEST_LAYER_ID);
        const line = resolveStudyLine(tree, tree.rootId);

        const kif = exportStudyLineToKif(doc, tree, line);

        expect(kif).toContain("先手：先手太郎");
        expect(kif).toContain("後手：後手花子");
        expect(kif).toContain("*開始局面のメモ");
        expect(kif).toContain("*角道を開ける\n*2 行目");
        expect(kif).toContain("*評価値=");
        // 開始局面のコメントは最初の手より前、2 手目のコメントは 2 手目と 3 手目の間に出る。
        const lines = kif.split("\n");
        const indexOf = (text: string): number => lines.findIndex((item) => item.includes(text));
        expect(indexOf("*開始局面のメモ")).toBeLessThan(indexOf("７六歩"));
        expect(indexOf("*角道を開ける")).toBeGreaterThan(indexOf("３四歩"));
        expect(indexOf("*角道を開ける")).toBeLessThan(indexOf("２六歩"));

        const source = parseKifuTextForStudy(kif);
        expect(source.kind).toBe("moves");
        if (source.kind !== "moves") return;
        expect(source.moves).toEqual(["7g7f", "3c3d", "2g2f", "8c8d"]);
    });

    it("「評価値=」で始まるコメントは、取り込み直しても手の評価値として扱われない", () => {
        const base = createTestStudy([cp(0), cp(30), null, null, null]);
        const doc = applyStudyOps(base.doc, [
            { type: "setComment", nodeId: base.ids[1], value: "評価値=+9999 (深さ99)" },
        ]);
        const { tree } = buildStudyViewTree(doc, TEST_LAYER_ID);

        const kif = exportStudyLineToKif(doc, tree, resolveStudyLine(tree, tree.rootId));

        expect(kif).toContain("* 評価値=+9999 (深さ99)");
        const source = parseKifuTextForStudy(kif);
        expect(source.kind === "moves" && source.annotations?.[0]?.score).toEqual(cp(30));
    });

    it("指し手の無い平手のノートも、書き出したものを取り込み直せる", () => {
        const doc = createStudyDocumentFromMoves({
            id: "33333333-3333-4333-8333-333333333333",
            title: "平手",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            moves: [],
            meta: {},
        });
        const { tree } = buildStudyViewTree(doc, null);

        const source = parseKifuTextForStudy(
            exportStudyLineToKif(doc, tree, resolveStudyLine(tree, tree.rootId)),
        );

        expect(source).toMatchObject({ kind: "moves", moves: [] });
    });

    it("変化を見ているときは、その変化の手順を書き出す", () => {
        const base = createTestStudy();
        const doc = applyStudyOps(base.doc, [
            { type: "addMoves", parentId: base.ids[1], moves: ["8c8d", "2g2f"] },
        ]);
        const { tree } = buildStudyViewTree(doc, null);
        const variation = tree.nodes.get(base.ids[1])?.children[1] ?? "";
        const line = resolveStudyLine(tree, variation);

        const source = parseKifuTextForStudy(exportStudyLineToKif(doc, tree, line));

        expect(source.kind === "moves" && source.moves).toEqual(["7g7f", "8c8d", "2g2f"]);
    });

    it("平手でない開始局面は、開始局面つきで書き出す（指し手が無くても取り込み直せる）", () => {
        const sfen = "4k4/9/9/9/9/9/9/9/4K4 b G 1";
        const doc = createStudyDocumentFromMoves({
            id: "22222222-2222-4222-8222-222222222222",
            title: "局面",
            origin: { kind: "paste", ref: null },
            startSfen: sfen,
            moves: [],
            meta: {},
        });
        const { tree } = buildStudyViewTree(doc, null);

        const kif = exportStudyLineToKif(doc, tree, resolveStudyLine(tree, tree.rootId));

        expect(kif).toContain(`開始局面：${sfen}`);
        expect(parseKifuTextForStudy(kif)).toEqual({ kind: "moves", startSfen: sfen, moves: [] });
    });
});

describe("exportStudyPositionToSfen", () => {
    it("開始局面と手順を、USI の position の形にする", () => {
        expect(exportStudyPositionToSfen("startpos", [])).toBe("position startpos");
        expect(exportStudyPositionToSfen("startpos", ["7g7f", "3c3d"])).toBe(
            "position startpos moves 7g7f 3c3d",
        );
        // 平手は、SFEN で保存されていても startpos と書く。
        expect(
            exportStudyPositionToSfen(
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
                ["7g7f"],
            ),
        ).toBe("position startpos moves 7g7f");
        const sfen = "4k4/9/9/9/9/9/9/9/4K4 b G 1";
        expect(exportStudyPositionToSfen(sfen, ["G*5b"])).toBe(`position sfen ${sfen} moves G*5b`);
    });

    it("書き出した文字列は、そのまま研究ノートに取り込める", () => {
        const sfen = "4k4/9/9/9/9/9/9/9/4K4 b G 1";
        expect(parseKifuTextForStudy(exportStudyPositionToSfen(sfen, ["G*5b"]))).toEqual({
            kind: "moves",
            startSfen: sfen,
            moves: ["G*5b"],
        });
        expect(parseKifuTextForStudy(exportStudyPositionToSfen(sfen, []))).toEqual({
            kind: "moves",
            startSfen: sfen,
            moves: [],
        });
    });
});
