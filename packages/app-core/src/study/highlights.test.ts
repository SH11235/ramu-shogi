import { describe, expect, it } from "vitest";
import {
    computeStudyHighlights,
    STUDY_WIN_RATE_MODEL,
    studyScoreToSenteWinRate,
} from "./highlights";
import { studyChildNodeId, studyLayerId } from "./ids";
import { createStudyDocumentFromMoves } from "./import";
import { applyStudyOps } from "./ops";
import type { StudyDocument, StudyLayerSpec, StudyOp, StudyScore } from "./types";

const spec: StudyLayerSpec = {
    version: 1,
    engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
    evaluation: { nnueSha256: null, fvScale: null, progressSha256: null, layerStacks: null },
    limits: { timeMs: 1000, depth: 15, nodes: null },
    multiPv: 1,
    rules: { variant: "standard" },
};
const layerId = studyLayerId(spec);

const MOVES = ["7g7f", "3c3d", "2g2f", "8c8d", "2f2e", "8d8e"];

const cp = (value: number): StudyScore => ({ kind: "cp", value });
const mate = (winner: "sente" | "gote", plies: number | null): StudyScore => ({
    kind: "mate",
    winner,
    plies,
});

/** 本譜の各局面（添字 0 = 開始局面）に評価値を付けた文書を作る。null は未解析。 */
const docWithScores = (
    scores: Array<StudyScore | null>,
    startSfen = "startpos",
): { doc: StudyDocument; ids: string[] } => {
    const base = createStudyDocumentFromMoves({
        id: "study",
        title: "注目局面",
        origin: { kind: "paste", ref: null },
        startSfen,
        moves: startSfen === "startpos" ? MOVES : [],
    });
    const ids = [base.tree.rootId];
    for (const move of startSfen === "startpos" ? MOVES : []) {
        ids.push(studyChildNodeId(ids[ids.length - 1], move));
    }
    const ops: StudyOp[] = [{ type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } }];
    scores.forEach((score, index) => {
        if (score === null) return;
        ops.push({
            type: "putAnalysis",
            layerId,
            nodeId: ids[index],
            result: {
                runId: "run",
                completion: "completed",
                depth: 15,
                nodes: null,
                timeMs: null,
                execution: { threads: null, hashMb: null, parallelWorkers: null },
                candidates: [{ rank: 1, score, depth: 15, seldepth: null, pv: [] }],
            },
        });
    });
    return { doc: applyStudyOps(base, ops), ids };
};

describe("studyScoreToSenteWinRate", () => {
    it("logistic-cp-v1: P先手(cp) = 1 / (1 + exp(-cp / 600))", () => {
        expect(STUDY_WIN_RATE_MODEL).toBe("logistic-cp-v1");
        expect(studyScoreToSenteWinRate(cp(0))).toBe(0.5);
        expect(studyScoreToSenteWinRate(cp(600))).toBeCloseTo(1 / (1 + Math.exp(-1)), 12);
        expect(studyScoreToSenteWinRate(cp(-600))).toBeCloseTo(1 - 1 / (1 + Math.exp(-1)), 12);
    });

    it("詰みは勝者側を 1、反対側を 0 とする", () => {
        expect(studyScoreToSenteWinRate(mate("sente", 5))).toBe(1);
        expect(studyScoreToSenteWinRate(mate("gote", null))).toBe(0);
    });
});

describe("computeStudyHighlights", () => {
    it("先手の手は P(親) − P(子)、後手の手は P(子) − P(親) を落差とし、大きい順に並べる", () => {
        // 1 手目（先手）で -300、4 手目（後手）で +700、5 手目（先手）で -150。
        const { doc, ids } = docWithScores([
            cp(0),
            cp(-300),
            cp(-300),
            cp(-300),
            cp(400),
            cp(250),
            cp(250),
        ]);
        const highlights = computeStudyHighlights(doc, layerId);
        expect(highlights.map((item) => item.nodeId)).toEqual([ids[4], ids[1]]);

        const [blunder, dubious] = highlights;
        expect(blunder).toMatchObject({
            parentId: ids[3],
            ply: 4,
            usiMove: "8c8d",
            mover: "gote",
            isMainLine: true,
            kind: "blunder",
            scoreBefore: cp(-300),
            scoreAfter: cp(400),
            hasComment: false,
        });
        expect(blunder.drop).toBeCloseTo(
            studyScoreToSenteWinRate(cp(400)) - studyScoreToSenteWinRate(cp(-300)),
            12,
        );
        expect(dubious).toMatchObject({ ply: 1, mover: "sente", kind: "dubious" });
        expect(dubious.drop).toBeCloseTo(0.5 - studyScoreToSenteWinRate(cp(-300)), 12);
        // 5 手目の落差は 0.10 未満なので拾わない。
        expect(highlights.some((item) => item.nodeId === ids[5])).toBe(false);
    });

    it("しきい値: 0.20 以上が悪手、0.10 以上が疑問手", () => {
        // P が 0.5 → 0.3（落差 0.20）と 0.5 → 0.4（落差 0.10）になる評価値を逆算する。
        const cpFor = (p: number): number => Math.round(-600 * Math.log(1 / p - 1));
        const blunder = computeStudyHighlights(
            docWithScores([cp(0), cp(cpFor(0.29))]).doc,
            layerId,
        );
        expect(blunder[0]?.kind).toBe("blunder");
        const dubious = computeStudyHighlights(
            docWithScores([cp(0), cp(cpFor(0.39))]).doc,
            layerId,
        );
        expect(dubious[0]?.kind).toBe("dubious");
        const fine = computeStudyHighlights(docWithScores([cp(0), cp(cpFor(0.41))]).doc, layerId);
        expect(fine).toEqual([]);
    });

    it("良くなった手（落差が負）は拾わない", () => {
        const { doc } = docWithScores([cp(0), cp(800), cp(-800)]);
        // 1 手目は先手が得、2 手目は後手が得。
        expect(computeStudyHighlights(doc, layerId)).toEqual([]);
    });

    it("親か子が未解析なら判定しない（補間も 0 での代用もしない）", () => {
        // 2 手目の局面が欠けている。前後の値は大きく違うが、1〜3 手目のどれも判定できない。
        const { doc } = docWithScores([cp(0), null, cp(-900), null, cp(900)]);
        expect(computeStudyHighlights(doc, layerId)).toEqual([]);
        // ルートが未解析なら初手は判定できない。
        const noRoot = docWithScores([null, cp(-900)]).doc;
        expect(computeStudyHighlights(noRoot, layerId)).toEqual([]);
    });

    it("ルートが解析済みなら初手の良し悪しを判定できる", () => {
        const { doc, ids } = docWithScores([cp(0), cp(-900)]);
        expect(computeStudyHighlights(doc, layerId).map((item) => item.nodeId)).toEqual([ids[1]]);
    });

    it("詰みを逃した手は拾い、同じ勝者の詰みの手数差は拾わない", () => {
        const { doc, ids } = docWithScores([
            mate("sente", 9),
            mate("sente", 15),
            mate("sente", 3),
            cp(0),
            mate("gote", 5),
        ]);
        const highlights = computeStudyHighlights(doc, layerId);
        // 3 手目（先手）で詰みを逃し、4 手目（後手）は自分の勝ちの詰みに入っただけ。
        expect(highlights.map((item) => item.nodeId)).toEqual([ids[3]]);
        expect(highlights[0]).toMatchObject({ kind: "blunder", mover: "sente", drop: 0.5 });
    });

    it("コメントのある手は、評価値が無くても一覧に入る（落差で拾った手のあと）。しおりだけの手は入らない", () => {
        const { doc, ids } = docWithScores([cp(0), cp(-900)]);
        const marked = applyStudyOps(doc, [
            { type: "setBookmark", nodeId: ids[5], value: true },
            { type: "setComment", nodeId: ids[3], value: "ここを確認" },
            { type: "setComment", nodeId: ids[1], value: "悪手にコメント" },
        ]);
        const highlights = computeStudyHighlights(marked, layerId);
        expect(highlights.map((item) => item.nodeId)).toEqual([ids[1], ids[3]]);
        expect(highlights[0]).toMatchObject({ kind: "blunder", hasComment: true });
        expect(highlights[1]).toMatchObject({ kind: null, drop: null, hasComment: true });
        // レイヤーを表示していなくても、コメントのある手は並ぶ。
        expect(computeStudyHighlights(marked, null).map((item) => item.nodeId)).toEqual([
            ids[1],
            ids[3],
        ]);
    });

    it("対局時の評価値（source）は判定に使わない", () => {
        const base = createStudyDocumentFromMoves({
            id: "study",
            title: "source",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            moves: ["7g7f", "3c3d"],
            annotations: [{ score: cp(0) }, { score: cp(3000) }],
        });
        const doc = applyStudyOps(base, [
            { type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } },
        ]);
        expect(computeStudyHighlights(doc, layerId)).toEqual([]);
    });

    it("後手番から始まる局面では、初手を指した側は後手", () => {
        const sfen = "4k4/9/9/9/9/9/9/9/4K4 w - 1";
        const base = createStudyDocumentFromMoves({
            id: "study",
            title: "後手番開始",
            origin: { kind: "paste", ref: null },
            startSfen: sfen,
            moves: ["5a5b", "5i5h"],
        });
        const first = studyChildNodeId(base.tree.rootId, "5a5b");
        const second = studyChildNodeId(first, "5i5h");
        const put = (nodeId: string, score: StudyScore): StudyOp => ({
            type: "putAnalysis",
            layerId,
            nodeId,
            result: {
                runId: "run",
                completion: "completed",
                depth: 10,
                nodes: null,
                timeMs: null,
                execution: { threads: null, hashMb: null, parallelWorkers: null },
                candidates: [{ rank: 1, score, depth: 10, seldepth: null, pv: [] }],
            },
        });
        const doc = applyStudyOps(base, [
            { type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } },
            put(base.tree.rootId, cp(0)),
            // 後手の初手で先手が大きく良くなった = 後手の悪手。
            put(first, cp(900)),
            // 先手の 2 手目で互角に戻った = 先手の悪手。
            put(second, cp(0)),
        ]);
        const highlights = computeStudyHighlights(doc, layerId);
        expect(highlights.map((item) => [item.nodeId, item.mover, item.kind])).toEqual(
            expect.arrayContaining([
                [first, "gote", "blunder"],
                [second, "sente", "blunder"],
            ]),
        );
        expect(highlights).toHaveLength(2);
    });

    it("分岐の手も対象で、本譜かどうかが分かる", () => {
        const { doc, ids } = docWithScores([cp(0), cp(0)]);
        const branch = studyChildNodeId(ids[0], "2g2f");
        const withBranch = applyStudyOps(doc, [
            { type: "addMoves", parentId: ids[0], moves: ["2g2f"] },
            {
                type: "putAnalysis",
                layerId,
                nodeId: branch,
                result: {
                    runId: "run",
                    completion: "completed",
                    depth: 15,
                    nodes: null,
                    timeMs: null,
                    execution: { threads: null, hashMb: null, parallelWorkers: null },
                    candidates: [{ rank: 1, score: cp(-900), depth: 15, seldepth: null, pv: [] }],
                },
            },
        ]);
        expect(computeStudyHighlights(withBranch, layerId)).toMatchObject([
            { nodeId: branch, isMainLine: false, kind: "blunder", ply: 1 },
        ]);
    });
});

describe("computeStudyHighlights: 深く読んだ結果での判定し直し", () => {
    const deepSpec: StudyLayerSpec = {
        ...spec,
        limits: { timeMs: 30000, depth: 64, nodes: null },
        multiPv: 3,
    };
    const deepLayerId = studyLayerId(deepSpec);
    const putDeep = (
        nodeId: string,
        candidates: Array<{ score: StudyScore; move: string }>,
    ): StudyOp => ({
        type: "putAnalysis",
        layerId: deepLayerId,
        nodeId,
        result: {
            runId: "deep",
            completion: "completed",
            depth: 25,
            nodes: null,
            timeMs: null,
            execution: { threads: null, hashMb: null, parallelWorkers: null },
            candidates: candidates.map((candidate, index) => ({
                rank: index + 1,
                score: candidate.score,
                depth: 25,
                seldepth: null,
                pv: [candidate.move],
            })),
        },
    });
    const withDeep = (doc: StudyDocument, ops: StudyOp[]): StudyDocument =>
        applyStudyOps(doc, [
            { type: "ensureLayer", spec: deepSpec, display: { label: "RAMU・30 秒" } },
            ...ops,
        ]);
    const find = (doc: StudyDocument, nodeId: string) =>
        computeStudyHighlights(doc, layerId, { deeperLayerIds: [deepLayerId] }).find(
            (highlight) => highlight.nodeId === nodeId,
        );

    it("指した後の局面を深く読んで落差が無かったら、悪手を取り消し、元の判定を残す", () => {
        // 3 手目（☗2六歩）は、浅い解析では +20 → -900 の悪手。
        const { doc, ids } = docWithScores([cp(30), cp(40), cp(20), cp(-900), cp(-880)]);
        expect(find(doc, ids[3])?.kind).toBe("blunder");

        const revised = find(
            withDeep(doc, [putDeep(ids[3], [{ score: cp(10), move: "8c8d" }])]),
            ids[3],
        );
        expect(revised?.kind).toBeNull();
        expect(revised?.revisedFrom).toBe("blunder");
        expect(revised?.judgedByDeeper).toBe(true);
        expect(revised?.scoreAfter).toEqual(cp(10));
    });

    it("指す前の局面を深く読み、指した手が候補にあれば、同じ探索の中で最善手と比べる", () => {
        // 浅い解析では問題なし（+30 → +20）。深く読むと、最善 ☗7六歩 +200 に対して指した ☗2六歩 は -500。
        const { doc, ids } = docWithScores([cp(30), cp(40), cp(30), cp(20), cp(10)]);
        expect(find(doc, ids[3])).toBeUndefined();

        const deep = withDeep(doc, [
            putDeep(ids[2], [
                { score: cp(200), move: "7g7f" },
                { score: cp(-500), move: "2g2f" },
            ]),
        ]);
        const revised = find(deep, ids[3]);
        expect(revised?.kind).toBe("blunder");
        expect(revised?.revisedFrom).toBeNull();
        expect(revised?.scoreBefore).toEqual(cp(200));
        expect(revised?.scoreAfter).toEqual(cp(-500));
    });

    it("深く解析をすぐ止めて、元の結果より浅くしか読めていなければ、判定に使わない", () => {
        const { doc, ids } = docWithScores([cp(30), cp(40), cp(20), cp(-900), cp(-880)]);
        const shallow = putDeep(ids[3], [{ score: cp(10), move: "8c8d" }]);
        if (shallow.type !== "putAnalysis") throw new Error("putAnalysis ではありません");
        const kept = find(
            withDeep(doc, [{ ...shallow, result: { ...shallow.result, depth: 5 } }]),
            ids[3],
        );
        expect(kept?.kind).toBe("blunder");
        expect(kept?.judgedByDeeper).toBe(false);
        expect(kept?.revisedFrom).toBeUndefined();
    });

    it("深く読んでも判定が同じなら、判定の変化として知らせない", () => {
        const { doc, ids } = docWithScores([cp(30), cp(40), cp(20), cp(-900), cp(-880)]);
        const same = find(
            withDeep(doc, [putDeep(ids[3], [{ score: cp(-1000), move: "8c8d" }])]),
            ids[3],
        );
        expect(same?.kind).toBe("blunder");
        expect(same?.judgedByDeeper).toBe(true);
        expect(same?.revisedFrom).toBeUndefined();
    });
});
