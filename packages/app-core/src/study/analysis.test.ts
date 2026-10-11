import { describe, expect, it } from "vitest";
import {
    buildStudyLayerDisplay,
    buildStudyLayerRefFromNnue,
    buildStudyLayerSpec,
    createStudyAnalysisCollector,
    createStudyLayerRef,
} from "./analysis";
import { studyLayerId } from "./ids";

describe("createStudyAnalysisCollector", () => {
    it("候補ごとに最後の情報を採り、手番で先手視点に直し、統計を残す", () => {
        const collector = createStudyAnalysisCollector({
            runId: "9d6783f2-d773-4572-ae4e-bd463bf8f816",
            sideToMove: "gote",
            execution: { threads: 1, parallelWorkers: 4 },
        });
        collector.push({ depth: 10, scoreCp: 50, multipv: 1, pv: ["3c3d"], nodes: 1000 });
        collector.push({ depth: 10, scoreCp: 20, multipv: 2, pv: ["8c8d"], nodes: 1500 });
        // 評価値の無い情報（nps だけなど）は候補にしないが、統計は取り込む。
        collector.push({ nodes: 2000, timeMs: 500 });
        collector.push({
            depth: 15,
            seldepth: 22,
            scoreCp: -120,
            multipv: 1,
            pv: ["3c3d", "2g2f"],
            nodes: 123_456,
            timeMs: 1002,
        });
        collector.push({ depth: 14, scoreMate: 5, multipv: 2, pv: ["8c8d"] });

        expect(collector.finish("completed")).toEqual({
            runId: "9d6783f2-d773-4572-ae4e-bd463bf8f816",
            completion: "completed",
            depth: 15,
            nodes: 123_456,
            timeMs: 1002,
            execution: { threads: 1, hashMb: null, parallelWorkers: 4 },
            candidates: [
                {
                    rank: 1,
                    // 後手番の局面で手番側 -120 = 先手視点 +120。
                    score: { kind: "cp", value: 120 },
                    depth: 15,
                    seldepth: 22,
                    pv: ["3c3d", "2g2f"],
                },
                {
                    rank: 2,
                    // 後手番の局面で手番側の勝ちの詰み = 後手の勝ち。
                    score: { kind: "mate", winner: "gote", plies: 5 },
                    depth: 14,
                    seldepth: null,
                    pv: ["8c8d"],
                },
            ],
        });
    });

    it("最善候補が無ければ結果なし。取れない値は null / 0", () => {
        const empty = createStudyAnalysisCollector({ runId: "run", sideToMove: "sente" });
        empty.push({ nodes: 100 });
        empty.push({ depth: 3, scoreCp: 10, multipv: 2 });
        expect(empty.finish("completed")).toBeNull();

        const minimal = createStudyAnalysisCollector({ runId: "run", sideToMove: "sente" });
        minimal.push({ scoreCp: 10 });
        expect(minimal.finish("aborted")).toEqual({
            runId: "run",
            completion: "aborted",
            depth: 0,
            nodes: null,
            timeMs: null,
            execution: { threads: null, hashMb: null, parallelWorkers: null },
            candidates: [
                { rank: 1, score: { kind: "cp", value: 10 }, depth: 0, seldepth: null, pv: [] },
            ],
        });
    });

    it("読み筋は上限で切り、上限を超える順位の候補は捨てる。読み筋の無い更新では前の読み筋を保つ", () => {
        const collector = createStudyAnalysisCollector({ runId: "run", sideToMove: "sente" });
        collector.push({ depth: 5, scoreCp: 1, pv: Array.from({ length: 50 }, () => "7g7f") });
        collector.push({ depth: 6, scoreCp: 2 });
        collector.push({ depth: 6, scoreCp: 3, multipv: 6, pv: ["2g2f"] });
        const result = collector.finish("completed");
        expect(result?.candidates).toHaveLength(1);
        expect(result?.candidates[0]).toMatchObject({ depth: 6, score: { kind: "cp", value: 2 } });
        expect(result?.candidates[0].pv).toHaveLength(40);
    });
});

describe("buildStudyLayerSpec", () => {
    const input = {
        engine: { kind: "wasm", name: "rshogi", version: "0.8.1+05d89777" },
        appVersion: "1.2.3",
        nnue: {
            sha256: "AB".repeat(32),
            fvScale: 24,
            progressSha256: "CD".repeat(32),
            layerStacks: { bucketMode: "progresskpabs", progressBuckets: 8 },
        },
        limits: { timeMs: 1000, depth: 15 },
        multiPv: 3,
    } as const;

    it("AI・評価条件・探索上限・MultiPV を入れ、端末の資源は入れない", () => {
        expect(buildStudyLayerSpec(input)).toEqual({
            version: 1,
            engine: { kind: "wasm", name: "rshogi", version: "0.8.1+05d89777" },
            evaluation: {
                nnueSha256: "ab".repeat(32),
                fvScale: 24,
                progressSha256: "cd".repeat(32),
                layerStacks: { bucketMode: "progresskpabs", progressBuckets: 8 },
            },
            limits: { timeMs: 1000, depth: 15, nodes: null },
            multiPv: 3,
            rules: { variant: "standard" },
        });
    });

    it("NNUE を使わない場合と、無い項目は null", () => {
        expect(buildStudyLayerSpec({ ...input, nnue: null }).evaluation).toEqual({
            nnueSha256: null,
            fvScale: null,
            progressSha256: null,
            layerStacks: null,
        });
        expect(
            buildStudyLayerSpec({ ...input, nnue: { sha256: "ab".repeat(32) } }).evaluation,
        ).toEqual({
            nnueSha256: "ab".repeat(32),
            fvScale: null,
            progressSha256: null,
            layerStacks: null,
        });
    });

    it("エンジンの版が取れなければアプリの版で代用する（unknown で合流させない）", () => {
        for (const version of [null, undefined, "", "  "]) {
            expect(
                buildStudyLayerSpec({ ...input, engine: { ...input.engine, version } }).engine,
            ).toEqual({ kind: "wasm", name: "rshogi", version: "app-1.2.3" });
        }
    });

    it("探索上限が違えば別のレイヤー、同じ設定なら同じレイヤーになる", () => {
        const oneSecond = buildStudyLayerSpec(input);
        const tenSeconds = buildStudyLayerSpec({ ...input, limits: { timeMs: 10_000, depth: 15 } });
        expect(studyLayerId(oneSecond)).not.toBe(studyLayerId(tenSeconds));
        expect(studyLayerId(buildStudyLayerSpec({ ...input }))).toBe(studyLayerId(oneSecond));
        expect(studyLayerId(buildStudyLayerSpec({ ...input, multiPv: 1 }))).not.toBe(
            studyLayerId(oneSecond),
        );
    });

    it("MultiPV は 1〜5 に収める", () => {
        expect(buildStudyLayerSpec({ ...input, multiPv: 0 }).multiPv).toBe(1);
        expect(buildStudyLayerSpec({ ...input, multiPv: 9 }).multiPv).toBe(5);
    });
});

describe("buildStudyLayerDisplay", () => {
    it("表示名を設定から作る。プリセットキーは spec ではなくこちらに入れる", () => {
        expect(
            buildStudyLayerDisplay({
                name: "RAMU",
                limits: { timeMs: 1000, depth: 15, nodes: null },
                presetKey: "ramu",
            }),
        ).toEqual({ label: "RAMU・1 秒", nnueName: "RAMU", presetKey: "ramu" });
        expect(
            buildStudyLayerDisplay({
                name: "RAMU",
                limits: { timeMs: 500, depth: null, nodes: null },
            }).label,
        ).toBe("RAMU・0.5 秒");
        expect(
            buildStudyLayerDisplay({
                name: "外部エンジン",
                limits: { timeMs: null, depth: 20, nodes: null },
            }).label,
        ).toBe("外部エンジン・深さ 20");
        expect(
            buildStudyLayerDisplay({ name: "", limits: { timeMs: null, depth: null, nodes: null } })
                .label,
        ).toBe("AI");
    });

    it("createStudyLayerRef は layerId を付ける", () => {
        const spec = buildStudyLayerSpec({
            engine: { kind: "native", name: "rshogi", version: "0.8.1" },
            appVersion: "1.0.0",
            nnue: null,
            limits: { timeMs: 1000 },
            multiPv: 1,
        });
        const display = buildStudyLayerDisplay({ name: "駒得", limits: spec.limits });
        expect(createStudyLayerRef(spec, display)).toEqual({
            layerId: studyLayerId(spec),
            spec,
            display,
        });
    });
});

describe("buildStudyLayerRefFromNnue", () => {
    const engine = { kind: "wasm", name: "rshogi", version: "0.8.1+05d89777" } as const;

    it("解決済みの NNUE とメタ情報から、spec・表示名・layerId を作る", () => {
        const layer = buildStudyLayerRefFromNnue({
            engine,
            appVersion: "1.2.3",
            resolved: {
                nnueId: "local-uuid",
                fvScale: 24,
                layerStacks: {
                    bucketMode: "progresskpabs",
                    progressBuckets: 8,
                    progressCoeffBase64: "AAAA",
                },
            },
            meta: {
                contentHashSha256: "ab".repeat(32),
                progressCoefficientsSha256: "cd".repeat(32),
                displayName: "RAMU",
                presetKey: "ramu",
            },
            limits: { timeMs: 1000, depth: 15 },
            multiPv: 3,
        });
        expect(layer.spec).toEqual({
            version: 1,
            engine,
            evaluation: {
                nnueSha256: "ab".repeat(32),
                fvScale: 24,
                progressSha256: "cd".repeat(32),
                // 係数の本体は入れない（SHA-256 で識別する）。端末ごとの nnueId も入れない。
                layerStacks: { bucketMode: "progresskpabs", progressBuckets: 8 },
            },
            limits: { timeMs: 1000, depth: 15, nodes: null },
            multiPv: 3,
            rules: { variant: "standard" },
        });
        expect(layer.display).toEqual({ label: "RAMU・1 秒", nnueName: "RAMU", presetKey: "ramu" });
        expect(layer.layerId).toBe(studyLayerId(layer.spec));
    });

    it("NNUE を使わない場合は評価条件がすべて null になる", () => {
        const layer = buildStudyLayerRefFromNnue({
            engine: { kind: "external", name: "YaneuraOu", version: "YaneuraOu NNUE 9.00" },
            appVersion: "1.2.3",
            resolved: null,
            meta: null,
            fallbackName: "YaneuraOu",
            limits: { nodes: 1_000_000 },
            multiPv: 1,
        });
        expect(layer.spec.evaluation).toEqual({
            nnueSha256: null,
            fvScale: null,
            progressSha256: null,
            layerStacks: null,
        });
        expect(layer.display.label).toBe("YaneuraOu・1000000 ノード");
    });

    it("NNUE を使うのにメタ情報が無ければ例外にする（別の AI の結果と合流させない）", () => {
        expect(() =>
            buildStudyLayerRefFromNnue({
                engine,
                appVersion: "1.2.3",
                resolved: { nnueId: "local-uuid", fvScale: 24 },
                meta: null,
                limits: { timeMs: 1000 },
                multiPv: 1,
            }),
        ).toThrow();
    });
});
