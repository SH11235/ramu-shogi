import { describe, expect, it } from "vitest";
import { studyChildNodeId, studyLayerId } from "./ids";
import { createStudyDocumentFromMoves } from "./import";
import { applyStudyOps, StudyOpError } from "./ops";
import {
    STUDY_LIMITS,
    type StudyAnalysisResult,
    type StudyDocument,
    type StudyLayerSpec,
    type StudyOp,
} from "./types";
import {
    applyStudyOpsStrict,
    assertStudyAnalysisResult,
    assertStudyLayerDisplay,
    assertStudyLayerSpec,
    assertStudySource,
    isBoundedStudyJson,
    isStudyStartSfen,
    isStudyUuid,
    StudyLimitError,
    validateStudyDocument,
} from "./validation";

const STUDY_ID = "b1181ba0-5387-4d97-9e3c-e89bdfb94c7b";

const baseDoc = (moves: string[] = ["7g7f", "3c3d"]): StudyDocument =>
    createStudyDocumentFromMoves({
        id: STUDY_ID,
        title: "検証",
        origin: { kind: "paste", ref: null },
        startSfen: "startpos",
        moves,
    });

const spec = (timeMs = 1000): StudyLayerSpec => ({
    version: 1,
    engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
    evaluation: { nnueSha256: null, fvScale: null, progressSha256: null, layerStacks: null },
    limits: { timeMs, depth: 15, nodes: null },
    multiPv: 1,
    rules: { variant: "standard" },
});

const result = (overrides: Partial<StudyAnalysisResult> = {}): StudyAnalysisResult => ({
    runId: "9d6783f2-d773-4572-ae4e-bd463bf8f816",
    completion: "completed",
    depth: 15,
    nodes: 1000,
    timeMs: 1000,
    execution: { threads: 1, hashMb: null, parallelWorkers: 4 },
    candidates: [
        { rank: 1, score: { kind: "cp", value: 120 }, depth: 15, seldepth: 22, pv: ["3c3d"] },
    ],
    ...overrides,
});

const candidate = (rank: number, pvLength = 1): StudyAnalysisResult["candidates"][number] => ({
    rank,
    score: { kind: "cp", value: 0 },
    depth: 10,
    seldepth: null,
    pv: Array.from({ length: pvLength }, () => "7g7f"),
});

/** 上限超過として拒否され、超えた上限の名前が分かること。 */
const expectLimit = (run: () => unknown, limit: string): void => {
    let caught: unknown;
    try {
        run();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(StudyLimitError);
    expect(caught).toBeInstanceOf(StudyOpError);
    expect((caught as StudyLimitError).limit).toBe(limit);
};

/** 入力不正として拒否されること（上限超過ではない）。 */
const expectInvalid = (run: () => unknown): void => {
    let caught: unknown;
    try {
        run();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(StudyOpError);
    expect(caught).not.toBeInstanceOf(StudyLimitError);
};

describe("isStudyUuid / isBoundedStudyJson", () => {
    it("小文字の UUID v4 だけを通す", () => {
        expect(isStudyUuid("9d6783f2-d773-4572-ae4e-bd463bf8f816")).toBe(true);
        expect(isStudyUuid("9D6783F2-D773-4572-AE4E-BD463BF8F816")).toBe(false);
        expect(isStudyUuid("9d6783f2-d773-1572-ae4e-bd463bf8f816")).toBe(false);
        expect(isStudyUuid("batch-1")).toBe(false);
    });

    it("入れ子の深さは 8 まで。JSON にできない値は通さない", () => {
        const nest = (depth: number): unknown => (depth === 0 ? 1 : [nest(depth - 1)]);
        expect(isBoundedStudyJson(nest(8))).toBe(true);
        expect(isBoundedStudyJson(nest(9))).toBe(false);
        expect(isBoundedStudyJson({ a: { b: [1, "x", null, true] } })).toBe(true);
        expect(isBoundedStudyJson({ a: Number.NaN })).toBe(false);
        expect(isBoundedStudyJson({ a: () => 1 })).toBe(false);
        expect(isBoundedStudyJson(new Date())).toBe(false);
    });
});

describe("操作の入力の検証（サーバーと同じ規則）", () => {
    const doc = baseDoc();
    const firstId = studyChildNodeId(doc.tree.rootId, "7g7f");
    const layerId = studyLayerId(spec());
    const withLayer = applyStudyOps(doc, [
        { type: "ensureLayer", spec: spec(), display: { label: "RAMU・1 秒" } },
    ]);
    const put = (value: StudyAnalysisResult): StudyOp => ({
        type: "putAnalysis",
        layerId,
        nodeId: firstId,
        result: value,
    });

    it("コメントは UTF-8 で 4 KiB まで（対象のノードが無くても拒否する）", () => {
        const ok = "あ".repeat(1365); // 4095 バイト
        expect(
            applyStudyOpsStrict(doc, [{ type: "setComment", nodeId: firstId, value: ok }]).tree
                .nodes[firstId].comment,
        ).toBe(ok);
        expectLimit(
            () =>
                applyStudyOpsStrict(doc, [
                    { type: "setComment", nodeId: firstId, value: `${ok}ab` },
                ]),
            "commentBytes",
        );
        expectLimit(
            () =>
                applyStudyOpsStrict(doc, [
                    { type: "setComment", nodeId: "0".repeat(32), value: "😀".repeat(1025) },
                ]),
            "commentBytes",
        );
    });

    it("表題は 200 コードポイントまで（サロゲートペアは 1 文字）", () => {
        expect(
            applyStudyOpsStrict(doc, [{ type: "setTitle", value: "😀".repeat(200) }]).title,
        ).toBe("😀".repeat(200));
        expectLimit(
            () => applyStudyOpsStrict(doc, [{ type: "setTitle", value: "あ".repeat(201) }]),
            "titleLength",
        );
    });

    it("解析結果: 候補は 5 本まで、rank は重複なしで 1 を含む、読み筋は 40 手まで", () => {
        expect(() =>
            applyStudyOpsStrict(withLayer, [
                put(result({ candidates: [1, 2, 3, 4, 5].map((rank) => candidate(rank, 40)) })),
            ]),
        ).not.toThrow();
        expectLimit(
            () =>
                applyStudyOpsStrict(withLayer, [
                    put(result({ candidates: [1, 2, 3, 4, 5, 6].map((rank) => candidate(rank)) })),
                ]),
            "multiPv",
        );
        expectLimit(
            () => applyStudyOpsStrict(withLayer, [put(result({ candidates: [candidate(1, 41)] }))]),
            "pvLength",
        );
        expectInvalid(() =>
            applyStudyOpsStrict(withLayer, [
                put(result({ candidates: [candidate(1), candidate(1)] })),
            ]),
        );
        expectInvalid(() =>
            applyStudyOpsStrict(withLayer, [put(result({ candidates: [candidate(2)] }))]),
        );
        expectInvalid(() => applyStudyOpsStrict(withLayer, [put(result({ candidates: [] }))]));
    });

    it("解析結果: 形が契約と違うものは入力不正", () => {
        const invalids: unknown[] = [
            result({ runId: "run-1" }),
            result({ runId: "9D6783F2-D773-4572-AE4E-BD463BF8F816" }),
            result({ depth: -1 }),
            result({ depth: 1.5 }),
            result({ nodes: -1 }),
            { ...result(), completion: "running" },
            { ...result(), extra: 1 },
            (() => {
                const { timeMs: _omitted, ...rest } = result();
                return rest;
            })(),
            result({ execution: { threads: 1, hashMb: null } as never }),
            result({ candidates: [{ ...candidate(1), pv: ["pass"] }] }),
            result({ candidates: [{ ...candidate(1), extra: true } as never] }),
            result({
                candidates: [{ ...candidate(1), score: { kind: "cp", value: 1.5 } }],
            }),
            result({
                candidates: [
                    { ...candidate(1), score: { kind: "mate", winner: "sente", plies: -1 } },
                ],
            }),
        ];
        for (const value of invalids) {
            expectInvalid(() => assertStudyAnalysisResult(value as StudyAnalysisResult));
        }
        // 候補の評価値は欠測（null）でもよい。
        expect(() =>
            assertStudyAnalysisResult(result({ candidates: [{ ...candidate(1), score: null }] })),
        ).not.toThrow();
    });

    it("レイヤー: spec の形、MultiPV の上限、layerStacks と display の深さ・大きさ", () => {
        expect(() => assertStudyLayerSpec(spec())).not.toThrow();
        expectLimit(() => assertStudyLayerSpec({ ...spec(), multiPv: 6 }), "multiPv");
        expectInvalid(() => assertStudyLayerSpec({ ...spec(), multiPv: 0 }));
        expectInvalid(() =>
            assertStudyLayerSpec({ ...spec(), engine: { ...spec().engine, version: "" } }),
        );
        expectInvalid(() =>
            assertStudyLayerSpec({
                ...spec(),
                evaluation: { ...spec().evaluation, nnueSha256: "AB".repeat(32) },
            }),
        );
        expectInvalid(() =>
            assertStudyLayerSpec({ ...spec(), limits: { timeMs: 1000, depth: 15 } as never }),
        );
        const nest = (depth: number): unknown => (depth === 0 ? 1 : { a: nest(depth - 1) });
        const withStacks = (layerStacks: unknown): StudyLayerSpec => ({
            ...spec(),
            evaluation: { ...spec().evaluation, layerStacks: layerStacks as never },
        });
        expect(() => assertStudyLayerSpec(withStacks(nest(8)))).not.toThrow();
        expectInvalid(() => assertStudyLayerSpec(withStacks(nest(9))));
        // 小数が入っていると layerId を計算できない。
        expectInvalid(() => assertStudyLayerSpec(withStacks({ scale: 0.5 })));
        expectLimit(
            () => assertStudyLayerSpec(withStacks({ note: "x".repeat(5000) })),
            "layerSpecBytes",
        );

        expect(() =>
            assertStudyLayerDisplay({ label: "RAMU・1 秒", nnueName: "RAMU" }),
        ).not.toThrow();
        expectInvalid(() => assertStudyLayerDisplay({} as never));
        expectInvalid(() => assertStudyLayerDisplay({ label: "x", extra: nest(9) } as never));
        expectLimit(
            () => assertStudyLayerDisplay({ label: "x".repeat(5000) }),
            "layerDisplayBytes",
        );
    });

    it("対局時の評価値: kind は 1〜32 文字、読み筋は 40 手まで", () => {
        const source = { kind: "csa", score: null, pv: null, elapsedMs: null };
        expect(() => assertStudySource(source)).not.toThrow();
        expect(() => assertStudySource(null)).not.toThrow();
        expectInvalid(() => assertStudySource({ ...source, kind: "" }));
        expectInvalid(() => assertStudySource({ ...source, kind: "x".repeat(33) }));
        expectInvalid(() => assertStudySource({ ...source, elapsedMs: -1 }));
        expectInvalid(() => assertStudySource({ kind: "csa", score: null, pv: null } as never));
        expectLimit(
            () => assertStudySource({ ...source, pv: Array.from({ length: 41 }, () => "7g7f") }),
            "pvLength",
        );
    });

    it("ノード数は 2,000 まで、手順の長さは 1,024 手まで、レイヤーは 8 つまで", () => {
        // 5g5f と 5c5d のあと、5h と 5b の飛車…ではなく、玉を往復させて長い手順を作る。
        const shuffle = ["5i5h", "5a5b", "5h5i", "5b5a"];
        const line = (length: number): string[] =>
            Array.from({ length }, (_, i) => shuffle[i % shuffle.length]);
        const root = baseDoc([]);
        const rootId = root.tree.rootId;
        const longest = applyStudyOpsStrict(root, [
            { type: "addMoves", parentId: rootId, moves: line(STUDY_LIMITS.lineLength) },
        ]);
        expect(Object.keys(longest.tree.nodes)).toHaveLength(STUDY_LIMITS.lineLength + 1);
        expectLimit(
            () =>
                applyStudyOpsStrict(root, [
                    {
                        type: "addMoves",
                        parentId: rootId,
                        moves: line(STUDY_LIMITS.lineLength + 1),
                    },
                ]),
            "lineLength",
        );

        // 1,024 手の本譜に、初手の違う 975 手の枝を足すと 2,000 ノード。もう 1 手で超える。
        const second = ["4i4h", ...line(974)];
        const full = applyStudyOpsStrict(longest, [
            { type: "addMoves", parentId: rootId, moves: second },
        ]);
        expect(Object.keys(full.tree.nodes)).toHaveLength(STUDY_LIMITS.nodesPerStudy);
        expectLimit(
            () =>
                applyStudyOpsStrict(full, [
                    { type: "addMoves", parentId: rootId, moves: ["6i6h"] },
                ]),
            "nodesPerStudy",
        );
        // 既にある手をたどるだけなら、上限いっぱいでも通る。
        expect(
            applyStudyOpsStrict(full, [{ type: "addMoves", parentId: rootId, moves: ["5i5h"] }]),
        ).toBe(full);

        const eight = Array.from(
            { length: 8 },
            (_, i): StudyOp => ({
                type: "ensureLayer",
                spec: spec(1000 + i),
                display: { label: `L${i}` },
            }),
        );
        const layered = applyStudyOpsStrict(root, eight);
        expect(layered.layers).toHaveLength(8);
        expectLimit(
            () =>
                applyStudyOpsStrict(layered, [
                    { type: "ensureLayer", spec: spec(5000), display: { label: "L9" } },
                ]),
            "layersPerStudy",
        );
        // 既にあるレイヤーの ensureLayer は通る。
        expect(applyStudyOpsStrict(layered, eight)).toBe(layered);
    });

    it("ツリーとレイヤーの結果の JSON の大きさ", () => {
        const doc2 = baseDoc(["7g7f", "3c3d", "2g2f", "8c8d"]);
        const ids = Object.keys(doc2.tree.nodes);
        // 4 KiB 弱のコメントを 200 個付けると、ツリーの JSON が 768 KiB を超える。
        const moves = Array.from(
            { length: 200 },
            (_, i) => ["5i5h", "5a5b", "5h5i", "5b5a"][i % 4],
        );
        const long = applyStudyOps(doc2, [
            { type: "addMoves", parentId: ids[ids.length - 1], moves },
        ]);
        const comments = Object.keys(long.tree.nodes).map(
            (nodeId): StudyOp => ({ type: "setComment", nodeId, value: "x".repeat(4000) }),
        );
        expectLimit(() => applyStudyOpsStrict(long, comments), "treeBytes");
        // 途中まで（収まる範囲）なら通る。
        expect(() => applyStudyOpsStrict(long, comments.slice(0, 100))).not.toThrow();
    });

    it("1 つでも拒否されたら全体を適用せず、渡した文書は変えない", () => {
        const snapshot = JSON.stringify(doc);
        expectLimit(
            () =>
                applyStudyOpsStrict(doc, [
                    { type: "setComment", nodeId: firstId, value: "正しい操作" },
                    { type: "setTitle", value: "あ".repeat(201) },
                ]),
            "titleLength",
        );
        expect(JSON.stringify(doc)).toBe(snapshot);
        // ルートの削除・空の手順は入力不正のまま。
        expectInvalid(() =>
            applyStudyOpsStrict(doc, [{ type: "deleteSubtree", nodeId: doc.tree.rootId }]),
        );
        expectInvalid(() =>
            applyStudyOpsStrict(doc, [{ type: "addMoves", parentId: doc.tree.rootId, moves: [] }]),
        );
    });
});

describe("validateStudyDocument", () => {
    it("取り込んだ文書と、操作を適用した文書を通す", () => {
        const doc = baseDoc();
        expect(() => validateStudyDocument(doc)).not.toThrow();
        const firstId = studyChildNodeId(doc.tree.rootId, "7g7f");
        const withLayer = applyStudyOps(doc, [
            { type: "ensureLayer", spec: spec(), display: { label: "RAMU・1 秒" } },
            {
                type: "putAnalysis",
                layerId: studyLayerId(spec()),
                nodeId: firstId,
                result: result(),
            },
        ]);
        expect(() => validateStudyDocument(withLayer)).not.toThrow();
    });

    it("上限を超える文書・形の違う文書を拒否する", () => {
        const doc = baseDoc();
        expectInvalid(() => validateStudyDocument({ ...doc, id: "not-a-uuid" }));
        expectInvalid(() => validateStudyDocument({ ...doc, startSfen: "startpos" }));
        expectInvalid(() =>
            validateStudyDocument({ ...doc, origin: { kind: "game_record", ref: null } }),
        );
        expectLimit(
            () => validateStudyDocument({ ...doc, title: "あ".repeat(201) }),
            "titleLength",
        );
        expectLimit(
            () => validateStudyDocument({ ...doc, meta: { event: "x".repeat(17 * 1024) } }),
            "metaBytes",
        );
        // 1,025 手の棋譜（本譜が長すぎる）。
        const shuffle = ["5i5h", "5a5b", "5h5i", "5b5a"];
        const tooLong = applyStudyOps(baseDoc([]), [
            {
                type: "addMoves",
                parentId: doc.tree.rootId,
                moves: Array.from({ length: 1025 }, (_, i) => shuffle[i % 4]),
            },
        ]);
        expectLimit(() => validateStudyDocument(tooLong), "lineLength");
    });
});

describe("backend と揃えた検証（レビュー 2 巡目）", () => {
    const doc = baseDoc();
    const rootId = doc.tree.rootId;
    const firstId = studyChildNodeId(rootId, "7g7f");

    it("操作の直下の未知のキー、nodeId / layerId の書式を拒否する", () => {
        const invalidOps: unknown[] = [
            { type: "setComment", nodeId: firstId, value: "x", extra: 1 },
            { type: "setComment", nodeId: "missing", value: "x" },
            { type: "setComment", nodeId: firstId.toUpperCase(), value: "x" },
            { type: "setBookmark", nodeId: "x", value: true },
            { type: "setSource", nodeId: "x", value: null },
            { type: "addMoves", parentId: "root", moves: ["7g7f"] },
            { type: "addMoves", parentId: rootId, moves: ["2g2f"], comment: "x" },
            { type: "reorderChildren", parentId: rootId, value: [firstId, "short"] },
            { type: "deleteSubtree", nodeId: "x" },
            { type: "deleteLayer", layerId: "x" },
            { type: "putAnalysis", layerId: "x", nodeId: firstId, result: result() },
            { type: "setTitle", value: "x", nodeId: firstId },
            { type: "ensureLayer", spec: spec(), display: { label: "x" }, id: "x" },
        ];
        for (const op of invalidOps) {
            expectInvalid(() => applyStudyOpsStrict(doc, [op as StudyOp]));
        }
        // 書式の正しい（が存在しない）ノードへの操作は、これまでどおり読み飛ばす。
        expect(
            applyStudyOpsStrict(doc, [{ type: "setComment", nodeId: "0".repeat(32), value: "x" }]),
        ).toBe(doc);
    });

    it("display の __proto__ という名前の項目を拒否する", () => {
        const display = JSON.parse('{"label":"x","__proto__":{"a":1}}');
        expectInvalid(() => assertStudyLayerDisplay(display));
    });

    it("source.kind の長さは UTF-16 のコード単位で数える（backend の zod と同じ）", () => {
        const source = { score: null, pv: null, elapsedMs: null };
        // 絵文字は 1 文字で 2 コード単位。16 個で 32、17 個で 34。
        expect(() => assertStudySource({ ...source, kind: "😀".repeat(16) })).not.toThrow();
        expectInvalid(() => assertStudySource({ ...source, kind: "😀".repeat(17) }));
    });

    it("既に上限を超えている文書でも、減らす操作は通す（増やす操作は拒否する）", () => {
        // 4 KiB 弱のコメントが 240 個で、ツリーの JSON は 900 KB を超える。
        const shuffle = ["5i5h", "5a5b", "5h5i", "5b5a"];
        const long = applyStudyOps(doc, [
            {
                type: "addMoves",
                parentId: rootId,
                moves: ["4i4h", ...Array.from({ length: 240 }, (_, i) => shuffle[i % 4])],
            },
        ]);
        const ids = Object.keys(long.tree.nodes);
        const oversize = applyStudyOps(
            long,
            ids.map((nodeId): StudyOp => ({ type: "setComment", nodeId, value: "x".repeat(4000) })),
        );
        expectLimit(() => validateStudyDocument(oversize), "treeBytes");

        // コメントを空にする・枝を消す・並べ替える（大きさが変わらない）は通る。
        const emptied = applyStudyOpsStrict(oversize, [
            { type: "setComment", nodeId: firstId, value: "" },
        ]);
        expect(emptied.tree.nodes[firstId].comment).toBe("");
        expect(() =>
            applyStudyOpsStrict(oversize, [
                { type: "deleteSubtree", nodeId: studyChildNodeId(rootId, "4i4h") },
            ]),
        ).not.toThrow();
        expect(() =>
            applyStudyOpsStrict(oversize, [
                {
                    type: "reorderChildren",
                    parentId: rootId,
                    value: [...oversize.tree.nodes[rootId].children].reverse(),
                },
            ]),
        ).not.toThrow();
        // 増やす操作は、超過している限り拒否する。
        expectLimit(
            () =>
                applyStudyOpsStrict(oversize, [
                    { type: "setComment", nodeId: firstId, value: "x".repeat(4001) },
                ]),
            "treeBytes",
        );
        expectLimit(
            () =>
                applyStudyOpsStrict(oversize, [
                    { type: "addMoves", parentId: rootId, moves: ["6i6h"] },
                ]),
            "treeBytes",
        );
        // 減らし続ければ、上限内に戻って普通に編集できる。
        const fixed = applyStudyOpsStrict(
            oversize,
            ids.slice(0, 120).map((nodeId): StudyOp => ({ type: "setComment", nodeId, value: "" })),
        );
        expect(() => validateStudyDocument(fixed)).not.toThrow();
        expect(() =>
            applyStudyOpsStrict(fixed, [{ type: "addMoves", parentId: rootId, moves: ["6i6h"] }]),
        ).not.toThrow();
    });

    it("ノード数が上限を超えている文書でも、枝を消せる・既にある手はたどれる", () => {
        const shuffle = ["5i5h", "5a5b", "5h5i", "5b5a"];
        const line = (first: string, length: number): string[] => [
            first,
            ...Array.from({ length: length - 1 }, (_, i) => shuffle[i % 4]),
        ];
        const over = applyStudyOps(baseDoc([]), [
            { type: "addMoves", parentId: rootId, moves: line("4i4h", 1000) },
            { type: "addMoves", parentId: rootId, moves: line("6i6h", 1000) },
            { type: "addMoves", parentId: rootId, moves: line("3i3h", 10) },
        ]);
        expect(Object.keys(over.tree.nodes).length).toBeGreaterThan(STUDY_LIMITS.nodesPerStudy);
        expectLimit(
            () =>
                applyStudyOpsStrict(over, [
                    { type: "addMoves", parentId: rootId, moves: ["7g7f"] },
                ]),
            "nodesPerStudy",
        );
        expect(
            applyStudyOpsStrict(over, [{ type: "addMoves", parentId: rootId, moves: ["4i4h"] }]),
        ).toBe(over);
        const trimmed = applyStudyOpsStrict(over, [
            { type: "deleteSubtree", nodeId: studyChildNodeId(rootId, "3i3h") },
        ]);
        expect(Object.keys(trimmed.tree.nodes)).toHaveLength(2001);
    });

    it("isStudyStartSfen: backend と同じ書式だけを通す", () => {
        expect(
            isStudyStartSfen("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1"),
        ).toBe(true);
        expect(isStudyStartSfen("7nl/7k1/6ppp/9/9/9/9/9/9 b RBGrb4g4s3n3l15p 1")).toBe(true);
        expect(isStudyStartSfen("4k4/9/4+P4/9/9/9/9/9/4K4 w 2P 34")).toBe(true);
        for (const sfen of [
            "startpos",
            "4k4/9/9/9/9/9/9/9/4K4 b -",
            "4k4/9/9/9/9/9/9/9/4K4  b - 1",
            "4k4/9/9/9/9/9/9/9/4K4 x - 1",
            "4k4/9/9/9/9/9/9/9/4K4 b - 0",
            "4k4/9/9/9/9/9/9/9/4K4 b PP 1",
            "4k4/9/9/9/9/9/9/9/4K4 b K 1",
            "4k4/9/9/9/9/9/9/9/4K3 b - 1",
            "4k4/9/9/9/9/9/9/9/+K8 b - 1",
            "4k4/9/9/9/9/9/9/4K4 b - 1",
        ]) {
            expect(isStudyStartSfen(sfen)).toBe(false);
        }
    });

    it("validateStudyDocument は、作成 API が 400 にする文書を検出する", () => {
        const secondId = studyChildNodeId(firstId, "3c3d");
        const withNode = (id: string, patch: object): StudyDocument => ({
            ...doc,
            tree: {
                ...doc.tree,
                nodes: { ...doc.tree.nodes, [id]: { ...doc.tree.nodes[id], ...patch } },
            },
        });
        const renamed = (() => {
            // 子の nodeId を、親と指し手から導けない値に付け替える。
            const fake = "f".repeat(32);
            const nodes = { ...doc.tree.nodes };
            nodes[fake] = nodes[secondId];
            delete nodes[secondId];
            nodes[firstId] = { ...nodes[firstId], children: [fake] };
            return { ...doc, tree: { ...doc.tree, nodes } };
        })();
        const invalidDocs: StudyDocument[] = [
            { ...doc, origin: { kind: "game_record", ref: "x".repeat(257) } },
            { ...doc, origin: { kind: "paste", ref: "x" } },
            { ...doc, startSfen: "4k4/9/9/9/9/9/9/9/4K4 b - 0" },
            // 開始局面を差し替えると、ルートの nodeId が合わなくなる。
            { ...doc, startSfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1" },
            renamed,
            withNode(secondId, { usiMove: null }),
            withNode(secondId, { usiMove: "pass" }),
            withNode(firstId, { children: [secondId, secondId] }),
            withNode(firstId, { bookmarked: "yes" }),
            withNode(rootId, { usiMove: "7g7f" }),
            { ...doc, meta: JSON.parse('{"__proto__":"x"}') },
            { ...doc, meta: { blackName: 1 as unknown as string } },
        ];
        for (const item of invalidDocs) {
            expectInvalid(() => validateStudyDocument(item));
        }
        expect(() =>
            validateStudyDocument({
                ...doc,
                origin: { kind: "game_record", ref: "x".repeat(256) },
            }),
        ).not.toThrow();
    });
});
