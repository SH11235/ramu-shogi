/**
 * 研究ノートの画面のテストで使う文書の作成。
 */

import {
    applyStudyOps,
    buildStudyLayerSpec,
    createStudyDocumentFromMoves,
    type StudyDocument,
    type StudyLayerSpec,
    type StudyOp,
    type StudyScore,
    studyChildNodeId,
    studyLayerId,
} from "@shogi/app-core";

/** 本譜（平手から 4 手）。 */
const TEST_MOVES = ["7g7f", "3c3d", "2g2f", "8c8d"];

export const TEST_LAYER_SPEC: StudyLayerSpec = buildStudyLayerSpec({
    engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
    appVersion: "0.0.0",
    nnue: { sha256: "a".repeat(64), fvScale: 24 },
    limits: { timeMs: 1000, depth: 15 },
    multiPv: 1,
});
export const TEST_LAYER_ID = studyLayerId(TEST_LAYER_SPEC);
const TEST_LAYER_LABEL = "RAMU・1 秒";

export const cp = (value: number): StudyScore => ({ kind: "cp", value });

/** 本譜の各ノートの ID（添字 0 = 開始局面）。 */
function testNodeIds(doc: StudyDocument, moves: readonly string[] = TEST_MOVES): string[] {
    const ids = [doc.tree.rootId];
    for (const move of moves) ids.push(studyChildNodeId(ids[ids.length - 1], move));
    return ids;
}

/** 解析結果を 1 つ入れる操作。 */
export function putScoreOp(
    nodeId: string,
    score: StudyScore,
    options: { layerId?: string; depth?: number; pv?: string[] } = {},
): StudyOp {
    const depth = options.depth ?? 15;
    return {
        type: "putAnalysis",
        layerId: options.layerId ?? TEST_LAYER_ID,
        nodeId,
        result: {
            runId: "run",
            completion: "completed",
            depth,
            nodes: null,
            timeMs: null,
            execution: { threads: null, hashMb: null, parallelWorkers: null },
            candidates: [{ rank: 1, score, depth, seldepth: null, pv: options.pv ?? [] }],
        },
    };
}

/**
 * テスト用の文書を作る。`scores` を渡すと、本譜の各局面（添字 0 = 開始局面）に
 * その評価値の解析結果を入れる（null は未解析）。
 */
export function createTestStudy(scores?: Array<StudyScore | null>): {
    doc: StudyDocument;
    ids: string[];
} {
    const base = createStudyDocumentFromMoves({
        id: "11111111-1111-4111-8111-111111111111",
        title: "テストのノート",
        origin: { kind: "paste", ref: null },
        startSfen: "startpos",
        moves: TEST_MOVES,
        meta: { blackName: "先手太郎", whiteName: "後手花子" },
    });
    const ids = testNodeIds(base);
    if (!scores) return { doc: base, ids };
    const ops: StudyOp[] = [
        { type: "ensureLayer", spec: TEST_LAYER_SPEC, display: { label: TEST_LAYER_LABEL } },
    ];
    scores.forEach((score, index) => {
        if (score !== null) ops.push(putScoreOp(ids[index], score));
    });
    return { doc: applyStudyOps(base, ops), ids };
}
