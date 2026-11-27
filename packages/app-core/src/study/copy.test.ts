import { describe, expect, it } from "vitest";
import { copyStudyDocument, summarizeStudyCopy } from "./copy";
import { studyChildNodeId, studyLayerId, studyRootNodeId } from "./ids";
import { createStudyDocumentFromMoves } from "./import";
import { applyStudyOps } from "./ops";
import type { StudyAnalysisResult, StudyDocument, StudyLayerSpec } from "./types";
import { validateStudyDocument } from "./validation";

const spec: StudyLayerSpec = {
    version: 1,
    engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
    evaluation: { nnueSha256: null, fvScale: null, progressSha256: null, layerStacks: null },
    limits: { timeMs: 1000, depth: null, nodes: null },
    multiPv: 1,
    rules: { variant: "standard" },
};
const layerId = studyLayerId(spec);

const result = (value: number): StudyAnalysisResult => ({
    runId: "9d6783f2-d773-4572-ae4e-bd463bf8f816",
    completion: "completed",
    depth: 15,
    nodes: 1000,
    timeMs: 1000,
    execution: { threads: 1, hashMb: null, parallelWorkers: null },
    candidates: [{ rank: 1, score: { kind: "cp", value }, depth: 15, seldepth: null, pv: [] }],
});

const MAIN = ["7g7f", "3c3d", "2g2f", "8c8d", "2f2e"];

/**
 * 本譜 5 手。1 手目から分かれる変化（☖8四歩 ☗2六歩）と、3 手目のあとで分かれる変化（☖4四歩）がある。
 * 各局面に解析結果とコメントを付ける。
 */
const fixture = () => {
    const base = createStudyDocumentFromMoves({
        id: "b1181ba0-5387-4d97-9e3c-e89bdfb94c7b",
        title: "元のノート",
        origin: { kind: "rshogi_csa", ref: "game-1" },
        startSfen: "startpos",
        moves: MAIN,
        meta: { blackName: "先手", whiteName: "後手" },
    });
    const at = (moves: string[]): string =>
        moves.reduce((parent, move) => studyChildNodeId(parent, move), base.tree.rootId);
    const main = [base.tree.rootId, ...MAIN.map((_, index) => at(MAIN.slice(0, index + 1)))];
    const doc: StudyDocument = applyStudyOps(base, [
        { type: "addMoves", parentId: main[1], moves: ["8c8d", "2g2f"] },
        { type: "addMoves", parentId: main[3], moves: ["4c4d"] },
        { type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } },
        ...main.map((nodeId, index) => ({
            type: "putAnalysis" as const,
            layerId,
            nodeId,
            result: result(index * 10),
        })),
        { type: "setComment", nodeId: main[2], value: "2 手目のコメント" },
        { type: "setComment", nodeId: at(["7g7f", "8c8d"]), value: "変化のコメント" },
    ]);
    return {
        doc,
        main,
        earlyVariation: [at(["7g7f", "8c8d"]), at(["7g7f", "8c8d", "2g2f"])],
        lateVariation: at([...MAIN.slice(0, 3), "4c4d"]),
    };
};

const copy = (
    doc: StudyDocument,
    options: Partial<Parameters<typeof copyStudyDocument>[1]> & { nodeId: string; line: string[] },
) =>
    copyStudyDocument(doc, {
        id: "c2b2c0c4-1e6f-4f79-9b8a-6c3c0a1e2f3d",
        title: "新しいノート",
        range: "upto",
        includeVariations: true,
        includeAnalysis: true,
        ...options,
    });

describe("copyStudyDocument", () => {
    it("開始局面からこの局面まで: 手前で分かれた変化をその先まで入れ、先で分かれた変化は入れない", () => {
        const { doc, main, earlyVariation, lateVariation } = fixture();
        const copied = copy(doc, { nodeId: main[3], line: main });
        expect(Object.keys(copied.tree.nodes).sort()).toEqual(
            [...main.slice(0, 4), ...earlyVariation].sort(),
        );
        expect(copied.tree.nodes[lateVariation]).toBeUndefined();
        expect(copied.tree.nodes[main[3]].children).toEqual([]);
        // 解析結果は入れた局面の分だけ、コメントも写す。
        expect(Object.keys(copied.layers[0].results).sort()).toEqual(main.slice(0, 4).sort());
        expect(copied.tree.nodes[main[2]].comment).toBe("2 手目のコメント");
        expect(copied.tree.nodes[earlyVariation[0]].comment).toBe("変化のコメント");
        expect(copied.origin).toEqual({ kind: "paste", ref: null });
        expect(copied.meta).toEqual(doc.meta);
        expect(() => validateStudyDocument(copied)).not.toThrow();
    });

    it("変化を入れない・解析結果とコメントを入れないを選べる", () => {
        const { doc, main } = fixture();
        const copied = copy(doc, {
            nodeId: main[3],
            line: main,
            includeVariations: false,
            includeAnalysis: false,
        });
        expect(Object.keys(copied.tree.nodes).sort()).toEqual(main.slice(0, 4).sort());
        expect(copied.layers).toEqual([]);
        expect(copied.tree.nodes[main[2]].comment).toBe("");
    });

    it("ノートまるごと: 変化を入れればすべて、入れなければ表示中の手順だけ", () => {
        const { doc, main } = fixture();
        const all = copy(doc, { nodeId: main[2], line: main, range: "all" });
        expect(Object.keys(all.tree.nodes).sort()).toEqual(Object.keys(doc.tree.nodes).sort());
        const lineOnly = copy(doc, {
            nodeId: main[2],
            line: main,
            range: "all",
            includeVariations: false,
        });
        expect(Object.keys(lineOnly.tree.nodes).sort()).toEqual([...main].sort());
    });

    it("変化の中から作ると、その手順が新しいノートの本譜になる", () => {
        const { doc, main, earlyVariation } = fixture();
        const line = [main[0], main[1], ...earlyVariation];
        const copied = copy(doc, { nodeId: earlyVariation[1], line, range: "all" });
        expect(copied.tree.nodes[main[1]].children[0]).toBe(earlyVariation[0]);
        expect(copied.tree.nodes[main[1]].children).toContain(main[2]);
    });

    it("この局面だけ: その局面を開始局面にし、解析結果とコメントをその局面の分だけ付け替える", () => {
        const { doc, main } = fixture();
        const copied = copy(doc, { nodeId: main[2], line: main, range: "here" });
        expect(copied.startSfen).toBe(
            "lnsgkgsnl/1r5b1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL b - 1",
        );
        const rootId = studyRootNodeId(copied.startSfen, copied.rules);
        expect(copied.tree.rootId).toBe(rootId);
        expect(Object.keys(copied.tree.nodes)).toEqual([rootId]);
        expect(copied.tree.nodes[rootId].comment).toBe("2 手目のコメント");
        expect(copied.layers[0].results).toEqual({ [rootId]: doc.layers[0].results[main[2]] });
        expect(() => validateStudyDocument(copied)).not.toThrow();

        const bare = copy(doc, {
            nodeId: main[2],
            line: main,
            range: "here",
            includeAnalysis: false,
        });
        expect(bare.layers).toEqual([]);
        expect(bare.tree.nodes[rootId].comment).toBe("");
    });

    it("この局面だけ: 対局時の評価値（source）も新しいルートに付け替える", () => {
        const { doc, main } = fixture();
        const source = {
            kind: "csa",
            score: { kind: "cp" as const, value: 120 },
            pv: null,
            elapsedMs: 3000,
        };
        const withSource = applyStudyOps(doc, [
            { type: "setSource", nodeId: main[2], value: source },
        ]);
        const copied = copy(withSource, { nodeId: main[2], line: main, range: "here" });
        expect(copied.tree.nodes[copied.tree.rootId].source).toEqual(source);
        expect(() => validateStudyDocument(copied)).not.toThrow();
    });

    it("元の文書は変えない", () => {
        const { doc, main } = fixture();
        const before = JSON.stringify(doc);
        copy(doc, { nodeId: main[3], line: main, includeAnalysis: false });
        copy(doc, { nodeId: main[3], line: main, range: "here" });
        expect(JSON.stringify(doc)).toBe(before);
    });
});

describe("summarizeStudyCopy", () => {
    it("範囲と変化のチェックに応じて、入る手数と変化の数を数える", () => {
        const { doc, main } = fixture();
        const at = (range: "upto" | "all" | "here", includeVariations = true) =>
            summarizeStudyCopy(doc, { nodeId: main[3], line: main, range, includeVariations });
        const counts = (plies: number, before: number, after: number) => ({
            currentPly: 3,
            linePlies: 5,
            plies,
            variationsBefore: { total: 1, included: before },
            variationsAfter: { total: 1, included: after },
        });
        expect(at("upto")).toEqual(counts(3, 1, 0));
        expect(at("upto", false)).toEqual(counts(3, 0, 0));
        expect(at("all")).toEqual(counts(5, 1, 1));
        expect(at("all", false)).toEqual(counts(5, 0, 0));
        expect(at("here")).toEqual(counts(0, 0, 0));
    });
});
