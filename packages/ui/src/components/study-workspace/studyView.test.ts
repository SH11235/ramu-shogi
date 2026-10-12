import {
    applyStudyOps,
    buildStudyLayerSpec,
    studyChildNodeId,
    studyLayerId,
} from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import {
    cp,
    createTestStudy,
    putScoreOp,
    TEST_LAYER_ID,
    TEST_LAYER_SPEC,
} from "./study-test-support";
import {
    buildStudyViewTree,
    chooseStudyDisplayLayer,
    countStudyUnanalyzed,
    formatStudyScore,
    pickStudyDeeperResult,
    pickStudyPositionResult,
    resolveStudyLine,
    studyDeletableBranchHead,
    studyLineEvalHistory,
    studyMainLineIds,
    studyMoveLabel,
    studyPlayersLabel,
} from "./studyView";

const DEEP_SPEC = buildStudyLayerSpec({
    ...{
        engine: { kind: "wasm" as const, name: "rshogi", version: "0.8.1" },
        appVersion: "0.0.0",
        nnue: { sha256: "a".repeat(64), fvScale: 24 },
    },
    limits: { timeMs: 10_000, depth: 64 },
    multiPv: 3,
});
const DEEP_LAYER_ID = studyLayerId(DEEP_SPEC);

describe("buildStudyViewTree", () => {
    it("ノードの ID は保存用の nodeId のままで、評価値は表示中のレイヤーの結果だけを載せる", () => {
        const { doc, ids } = createTestStudy([cp(30), cp(50), null, cp(-400), cp(-380)]);
        const { tree, unrestoredCount } = buildStudyViewTree(doc, TEST_LAYER_ID);
        expect(unrestoredCount).toBe(0);
        expect(tree.rootId).toBe(ids[0]);
        expect(tree.nodes.get(ids[1])?.eval?.scoreCp).toBe(50);
        expect(tree.nodes.get(ids[2])?.eval).toBeUndefined();
        // レイヤーを選んでいなければ、評価値は載らない（対局時の評価値も載せない）。
        expect(buildStudyViewTree(doc, null).tree.nodes.get(ids[1])?.eval).toBeUndefined();
    });
});

describe("resolveStudyLine", () => {
    const { doc, ids } = createTestStudy();
    // 2 手目に変化（☖8四歩）を足し、その先に 1 手足す。
    const branch1 = studyChildNodeId(ids[1], "8c8d");
    const branch2 = studyChildNodeId(branch1, "2g2f");
    const withBranch = applyStudyOps(doc, [
        { type: "addMoves", parentId: ids[1], moves: ["8c8d", "2g2f"] },
    ]);
    const { tree } = buildStudyViewTree(withBranch, null);

    it("何も見ていなければ本譜を末端までたどる", () => {
        const line = resolveStudyLine(tree, ids[0]);
        expect(line).toEqual(ids);
        expect(line.every((id) => studyMainLineIds(tree).has(id))).toBe(true);
    });

    it("変化の手を見ていれば、その変化を末端までたどる", () => {
        const line = resolveStudyLine(tree, branch1);
        expect(line).toEqual([ids[0], ids[1], branch1, branch2]);
        expect(line.every((id) => studyMainLineIds(tree).has(id))).toBe(false);
    });

    it("手を戻しても、見ていた変化の続きを保つ", () => {
        const previous = [ids[0], ids[1], branch1, branch2];
        expect(resolveStudyLine(tree, ids[1], previous)).toEqual(previous);
        // 別の枝へ移ったら、前の手順は引き継がない。
        expect(resolveStudyLine(tree, ids[2], previous)).toEqual(ids);
    });

    it("無くなったノードを指していたらルートからの本譜にする", () => {
        expect(resolveStudyLine(tree, "missing")).toEqual(ids);
    });
});

describe("表示の整形", () => {
    it("指し手・評価値・対局者を画面の表記にする", () => {
        const { doc, ids } = createTestStudy([cp(30), cp(50), cp(-120), null, null]);
        const { tree } = buildStudyViewTree(doc, TEST_LAYER_ID);
        expect(studyMoveLabel(tree, ids[0])).toBe("開始局面");
        expect(studyMoveLabel(tree, ids[1])).toBe("☗7六歩(77)");
        expect(studyMoveLabel(tree, ids[2])).toBe("☖3四歩(33)");
        expect(formatStudyScore(cp(120))).toBe("+120");
        expect(formatStudyScore({ kind: "mate", winner: "gote", plies: 5 })).toBe("-詰5");
        expect(formatStudyScore(null)).toBe("");
        expect(studyPlayersLabel(doc.meta)).toBe("☗先手太郎 対 ☖後手花子");
        expect(studyPlayersLabel({})).toBeNull();

        const history = studyLineEvalHistory(tree, ids);
        expect(history.map((entry) => entry.evalCp)).toEqual([30, 50, -120, null, null]);
        expect(history[1].mover).toBe("sente");
        expect(history[2].mover).toBe("gote");
    });
});

describe("解析結果の選び方", () => {
    it("表示するレイヤーは、保存してあった選択 → 無ければ結果の最も多いもの", () => {
        const { doc, ids } = createTestStudy([cp(0), cp(10), cp(20), null, null]);
        const withDeep = applyStudyOps(doc, [
            { type: "ensureLayer", spec: DEEP_SPEC, display: { label: "RAMU・10 秒" } },
            putScoreOp(ids[1], cp(15), { layerId: DEEP_LAYER_ID, depth: 30 }),
        ]);
        expect(chooseStudyDisplayLayer(withDeep.layers, null)).toBe(TEST_LAYER_ID);
        expect(chooseStudyDisplayLayer(withDeep.layers, DEEP_LAYER_ID)).toBe(DEEP_LAYER_ID);
        expect(chooseStudyDisplayLayer(withDeep.layers, "gone")).toBe(TEST_LAYER_ID);
        expect(chooseStudyDisplayLayer([], null)).toBeNull();
        // 並び順には頼らない。
        expect(chooseStudyDisplayLayer([...withDeep.layers].reverse(), null)).toBe(TEST_LAYER_ID);
    });

    it("候補手は表示中の設定の結果。より深く読めた結果は、差し替えずに別に返す", () => {
        const { doc, ids } = createTestStudy([cp(0), cp(10), cp(20), null, null]);
        const withDeep = applyStudyOps(doc, [
            { type: "ensureLayer", spec: DEEP_SPEC, display: { label: "RAMU・10 秒" } },
            putScoreOp(ids[1], cp(15), { layerId: DEEP_LAYER_ID, depth: 30 }),
        ]);
        // 深い結果があっても、候補手は表示中の設定（1 秒）のもの。
        const shown = pickStudyPositionResult(withDeep, ids[1], TEST_LAYER_ID);
        expect(shown?.layer.id).toBe(TEST_LAYER_ID);
        expect(shown?.result.candidates[0].score).toEqual(cp(10));
        const deep = pickStudyDeeperResult(withDeep, ids[1], TEST_LAYER_ID);
        expect(deep?.layer.id).toBe(DEEP_LAYER_ID);
        expect(deep?.result.depth).toBe(30);
        expect(pickStudyPositionResult(withDeep, ids[2], TEST_LAYER_ID)?.layer.id).toBe(
            TEST_LAYER_ID,
        );
        expect(pickStudyDeeperResult(withDeep, ids[2], TEST_LAYER_ID)).toBeNull();
        expect(pickStudyPositionResult(withDeep, ids[3], TEST_LAYER_ID)).toBeNull();
    });

    it("未解析の局面を数える（レイヤーが無ければ全局面）", () => {
        const { doc } = createTestStudy([cp(0), cp(10), null, null, null]);
        expect(countStudyUnanalyzed(doc, TEST_LAYER_ID)).toBe(3);
        expect(countStudyUnanalyzed(doc, null)).toBe(5);
        expect(TEST_LAYER_SPEC.limits.timeMs).toBe(1000);
    });
});

describe("候補手に出す結果（表示中の設定が基本）", () => {
    const OTHER_AI_SPEC = buildStudyLayerSpec({
        engine: { kind: "wasm" as const, name: "rshogi", version: "0.8.1" },
        appVersion: "0.0.0",
        nnue: null,
        limits: { timeMs: 10_000, depth: 64 },
        multiPv: 3,
    });
    const OTHER_AI_ID = studyLayerId(OTHER_AI_SPEC);

    it("別の AI の結果は、より深くても、その設定を選ぶまで出さない", () => {
        const { doc, ids } = createTestStudy([cp(0), cp(10), null, null, null]);
        const withOther = applyStudyOps(doc, [
            {
                type: "ensureLayer",
                spec: OTHER_AI_SPEC,
                display: { label: "簡易AI（駒得）・10 秒" },
            },
            putScoreOp(ids[1], cp(500), { layerId: OTHER_AI_ID, depth: 40 }),
            putScoreOp(ids[2], cp(500), { layerId: OTHER_AI_ID, depth: 40 }),
        ]);
        // 表示中（RAMU・1 秒）の結果がある局面: その結果を出す。
        const shown = pickStudyPositionResult(withOther, ids[1], TEST_LAYER_ID);
        expect(shown?.layer.id).toBe(TEST_LAYER_ID);
        // 表示中の設定に結果が無い局面: 別の AI の結果で埋めない。
        expect(pickStudyPositionResult(withOther, ids[2], TEST_LAYER_ID)).toBeNull();
        // 別の AI の結果は「より深い解析」としても添えない。
        expect(pickStudyDeeperResult(withOther, ids[1], TEST_LAYER_ID)).toBeNull();
        expect(pickStudyDeeperResult(withOther, ids[2], TEST_LAYER_ID)).toBeNull();
        // その設定を選べば出る。
        expect(pickStudyPositionResult(withOther, ids[2], OTHER_AI_ID)?.layer.id).toBe(OTHER_AI_ID);
        // 表示する設定が無ければ、何も出さない。
        expect(pickStudyPositionResult(withOther, ids[1], null)).toBeNull();
    });

    it("同じ AI でも、探索の上限が小さい設定の結果は「より深い解析」にしない", () => {
        const { doc, ids } = createTestStudy([cp(0), cp(10), null, null, null]);
        const withDeep = applyStudyOps(doc, [
            { type: "ensureLayer", spec: DEEP_SPEC, display: { label: "RAMU・10 秒" } },
            putScoreOp(ids[1], cp(15), { layerId: DEEP_LAYER_ID, depth: 30 }),
        ]);
        // 10 秒の設定を表示中に、1 秒の設定の結果は使わない。
        expect(pickStudyPositionResult(withDeep, ids[0], DEEP_LAYER_ID)).toBeNull();
        expect(pickStudyDeeperResult(withDeep, ids[0], DEEP_LAYER_ID)).toBeNull();
        expect(pickStudyPositionResult(withDeep, ids[1], DEEP_LAYER_ID)?.layer.id).toBe(
            DEEP_LAYER_ID,
        );
        expect(pickStudyDeeperResult(withDeep, ids[1], DEEP_LAYER_ID)).toBeNull();
    });
});

describe("変化の削除の対象", () => {
    it("いま見ている枝の、直近の分岐点から先を対象にする。本譜は対象にしない", () => {
        const { doc, ids } = createTestStudy();
        const head = studyChildNodeId(ids[0], "5g5f");
        const first = studyChildNodeId(head, "3c3d");
        const firstNext = studyChildNodeId(first, "2g2f");
        const second = studyChildNodeId(head, "8c8d");
        const nested = applyStudyOps(doc, [
            { type: "addMoves", parentId: ids[0], moves: ["5g5f", "3c3d", "2g2f"] },
            { type: "addMoves", parentId: head, moves: ["8c8d"] },
        ]);
        const { tree } = buildStudyViewTree(nested, null);
        expect([...studyMainLineIds(tree)]).toEqual(ids);
        // 本譜の上では消せない。
        expect(studyDeletableBranchHead(tree, ids[2])).toBeNull();
        expect(studyDeletableBranchHead(tree, ids[0])).toBeNull();
        // 変化の頭は、変化全体。
        expect(studyDeletableBranchHead(tree, head)).toBe(head);
        // 変化の中の枝は、その枝だけ（1 つ目の子でも「本譜」扱いにしない）。
        expect(studyDeletableBranchHead(tree, first)).toBe(first);
        expect(studyDeletableBranchHead(tree, firstNext)).toBe(first);
        expect(studyDeletableBranchHead(tree, second)).toBe(second);
    });
});
