import { applyStudyOps, buildStudyLayerSpec, studyLayerId } from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import { cp, createTestStudy, putScoreOp, TEST_LAYER_ID } from "./study-test-support";
import { deriveStudyPositionInsights, pickStudyBandResult } from "./studyPositionInsights";

const spec = (nnue: { sha256: string; fvScale: number } | null, timeMs: number) =>
    buildStudyLayerSpec({
        engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
        appVersion: "0.0.0",
        nnue,
        limits: { timeMs, depth: 64 },
        multiPv: 3,
    });
const SAME_AI_ID = studyLayerId(spec({ sha256: "a".repeat(64), fvScale: 24 }, 10_000));
const OTHER_AI_SPEC = spec(null, 10_000);
const OTHER_AI_ID = studyLayerId(OTHER_AI_SPEC);

/** 表示中の設定（深さ 15）に加えて、別の AI で読んだ結果のある局面。 */
const createWithOtherAi = (depth: number) => {
    const { doc, ids } = createTestStudy([cp(30), cp(40), cp(20), cp(10), cp(0)]);
    const withOther = applyStudyOps(doc, [
        { type: "ensureLayer", spec: OTHER_AI_SPEC, display: { label: "別の AI" } },
        putScoreOp(ids[0], cp(555), { layerId: OTHER_AI_ID, depth, pv: ["2g2f"] }),
    ]);
    return { doc: withOther, nodeId: ids[0] };
};

/** 局面の帯の結果と、候補手の欄の一覧に出す結果。 */
const picks = (
    doc: ReturnType<typeof createWithOtherAi>["doc"],
    nodeId: string,
    deep: { nodeId: string; layerId: string } | null,
) => {
    const args = {
        doc,
        displayLayerId: TEST_LAYER_ID,
        deepNodeId: deep?.nodeId ?? null,
        deepLayerId: deep?.layerId ?? null,
    };
    const insights = deriveStudyPositionInsights({ ...args, currentNodeId: nodeId });
    return {
        band: pickStudyBandResult({ ...args, nodeId })?.layer.id,
        panel: (insights.deeperResult ?? insights.positionResult)?.layer.id,
    };
};

describe("局面の帯と候補手の欄の結果", () => {
    it("別の AI の結果は、深くても表示中の AI の結果より優先しない", () => {
        const { doc, nodeId } = createWithOtherAi(30);
        expect(picks(doc, nodeId, null)).toEqual({ band: TEST_LAYER_ID, panel: TEST_LAYER_ID });
    });

    it("直前に別の AI で深く解析した局面では、浅くても帯と欄の両方がその結果を出す", () => {
        const { doc, nodeId } = createWithOtherAi(10);
        expect(picks(doc, nodeId, { nodeId, layerId: OTHER_AI_ID })).toEqual({
            band: OTHER_AI_ID,
            panel: OTHER_AI_ID,
        });
    });

    it("同じ AI で深く解析した結果が表示中の結果より浅ければ、帯と欄の両方が表示中の結果を出す", () => {
        const { doc, ids } = createTestStudy([cp(30), cp(40), cp(20), cp(10), cp(0)]);
        const withSame = applyStudyOps(doc, [
            {
                type: "ensureLayer",
                spec: spec({ sha256: "a".repeat(64), fvScale: 24 }, 10_000),
                display: { label: "RAMU・10 秒" },
            },
            putScoreOp(ids[0], cp(35), { layerId: SAME_AI_ID, depth: 9, pv: ["2g2f"] }),
        ]);
        expect(picks(withSame, ids[0], { nodeId: ids[0], layerId: SAME_AI_ID })).toEqual({
            band: TEST_LAYER_ID,
            panel: TEST_LAYER_ID,
        });
    });

    it("同じ AI・同じ探索の上限で候補手の数だけ違う設定で浅く読んでも、深い表示中の結果を出す", () => {
        const { doc, ids } = createTestStudy([cp(30), cp(40), cp(20), cp(10), cp(0)]);
        // 表示中の設定（RAMU・1 秒・深さ 15・候補 1）と、候補手の数だけが違う。
        const otherPvSpec = buildStudyLayerSpec({
            engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
            appVersion: "0.0.0",
            nnue: { sha256: "a".repeat(64), fvScale: 24 },
            limits: { timeMs: 1000, depth: 15 },
            multiPv: 3,
        });
        const otherPvId = studyLayerId(otherPvSpec);
        const withOtherPv = applyStudyOps(doc, [
            { type: "ensureLayer", spec: otherPvSpec, display: { label: "RAMU・1 秒・候補 1" } },
            putScoreOp(ids[0], cp(35), { layerId: otherPvId, depth: 8, pv: ["2g2f"] }),
        ]);
        expect(picks(withOtherPv, ids[0], { nodeId: ids[0], layerId: otherPvId })).toEqual({
            band: TEST_LAYER_ID,
            panel: TEST_LAYER_ID,
        });
    });
});
