import { describe, expect, it } from "vitest";
import { studyChildNodeId, studyRootNodeId } from "./ids";
import {
    createStudyDocumentFromCsa,
    createStudyDocumentFromMoves,
    generateStudyId,
} from "./import";
import { STANDARD_STUDY_RULES, STUDY_HIRATE_SFEN, STUDY_LIMITS } from "./types";
import { validateStudyDocument } from "./validation";

const CSA_HIRATE = [
    "V2.2",
    "N+RAMU",
    "N-Panda",
    "PI",
    "+",
    "+7776FU",
    "T1",
    "'** 120 -3334FU +2726FU",
    "-3334FU",
    "T2",
    "'** 100000",
    "+2726FU",
    "T0",
    "%TORYO",
].join("\n");

describe("createStudyDocumentFromMoves", () => {
    it("平手も startpos ではなく SFEN で持ち、本譜を 1 本のツリーにする", () => {
        const doc = createStudyDocumentFromMoves({
            id: "b1181ba0-5387-4d97-9e3c-e89bdfb94c7b",
            title: "  自分の対局  ",
            origin: { kind: "game_record", ref: "game-1" },
            startSfen: "startpos",
            moves: ["7g7f", "3c3d"],
            meta: { blackName: "先手", whiteName: "", result: "WIN_BLACK" },
        });
        const rootId = studyRootNodeId(STUDY_HIRATE_SFEN, STANDARD_STUDY_RULES);
        const first = studyChildNodeId(rootId, "7g7f");
        const second = studyChildNodeId(first, "3c3d");
        expect(doc).toEqual({
            id: "b1181ba0-5387-4d97-9e3c-e89bdfb94c7b",
            title: "自分の対局",
            origin: { kind: "game_record", ref: "game-1" },
            startSfen: STUDY_HIRATE_SFEN,
            rules: { variant: "standard" },
            meta: { blackName: "先手", result: "WIN_BLACK" },
            tree: {
                version: 1,
                rootId,
                nodes: {
                    [rootId]: {
                        parentId: null,
                        usiMove: null,
                        children: [first],
                        comment: "",
                        bookmarked: false,
                        source: null,
                    },
                    [first]: {
                        parentId: rootId,
                        usiMove: "7g7f",
                        children: [second],
                        comment: "",
                        bookmarked: false,
                        source: null,
                    },
                    [second]: {
                        parentId: first,
                        usiMove: "3c3d",
                        children: [],
                        comment: "",
                        bookmarked: false,
                        source: null,
                    },
                },
            },
            layers: [],
        });
    });

    it("手ごとの評価値・読み筋・消費時間は source に入る。無い項目は null", () => {
        const doc = createStudyDocumentFromMoves({
            id: "study",
            title: "取り込み",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            moves: ["7g7f", "3c3d", "2g2f"],
            annotations: [
                { score: { kind: "cp", value: 120 }, pv: ["3c3d"], elapsedMs: 1000 },
                { elapsedMs: 2500.4 },
                {},
            ],
            sourceKind: "kif",
        });
        const first = studyChildNodeId(doc.tree.rootId, "7g7f");
        const second = studyChildNodeId(first, "3c3d");
        const third = studyChildNodeId(second, "2g2f");
        expect(doc.tree.nodes[first].source).toEqual({
            kind: "kif",
            score: { kind: "cp", value: 120 },
            pv: ["3c3d"],
            elapsedMs: 1000,
        });
        expect(doc.tree.nodes[second].source).toEqual({
            kind: "kif",
            score: null,
            pv: null,
            elapsedMs: 2500,
        });
        expect(doc.tree.nodes[third].source).toBeNull();
    });

    it("読み筋は上限の手数で切り、表題は上限の文字数で切る", () => {
        const doc = createStudyDocumentFromMoves({
            id: "study",
            title: "あ".repeat(300),
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            moves: ["7g7f"],
            annotations: [{ pv: Array.from({ length: 60 }, () => "3c3d") }],
        });
        const first = studyChildNodeId(doc.tree.rootId, "7g7f");
        expect(doc.tree.nodes[first].source?.pv).toHaveLength(STUDY_LIMITS.pvLength);
        expect(Array.from(doc.title)).toHaveLength(STUDY_LIMITS.titleLength);
    });

    it("パスは、どの局面でも指せる手として取り込む（手番だけが替わる）", () => {
        const doc = createStudyDocumentFromMoves({
            id: "44444444-4444-4444-8444-444444444444",
            title: "パス",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            // 先手がパスし、後手が指し、後手番でもう一度パスが入る手順。
            moves: ["pass", "3c3d", "7g7f", "pass", "2g2f"],
        });
        expect(Object.keys(doc.tree.nodes)).toHaveLength(6);
        expect(() => validateStudyDocument(doc)).not.toThrow();
    });

    it("書式が違う指し手・動かせない指し手は例外にする", () => {
        const base = {
            id: "study",
            title: "不正",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
        } as const;
        expect(() => createStudyDocumentFromMoves({ ...base, moves: ["7g7f", "resign"] })).toThrow(
            /2 手目/,
        );
        expect(() => createStudyDocumentFromMoves({ ...base, moves: ["5e5d"] })).toThrow(/1 手目/);
        // 後手の駒を先手番で動かす。
        expect(() => createStudyDocumentFromMoves({ ...base, moves: ["3c3d"] })).toThrow(/1 手目/);
    });

    it("空の表題には既定の表題を入れる", () => {
        const doc = createStudyDocumentFromMoves({
            id: "study",
            title: "  ",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            moves: [],
        });
        expect(doc.title).toBe("研究ノート");
        expect(Object.keys(doc.tree.nodes)).toEqual([doc.tree.rootId]);
    });
});

describe("createStudyDocumentFromCsa", () => {
    it("CSA 棋譜の指し手・対局者名・評価値・読み筋・消費時間を取り込む", () => {
        const doc = createStudyDocumentFromCsa({
            id: "study",
            csa: CSA_HIRATE,
            origin: { kind: "rshogi_csa", ref: "wdoor-20261009000001-93ef4d36a6" },
            meta: { venue: "wdoor", event: "floodgate-300-10F" },
        });
        expect(doc.title).toBe("RAMU 対 Panda");
        expect(doc.origin).toEqual({ kind: "rshogi_csa", ref: "wdoor-20261009000001-93ef4d36a6" });
        expect(doc.startSfen).toBe(STUDY_HIRATE_SFEN);
        expect(doc.meta).toEqual({
            blackName: "RAMU",
            whiteName: "Panda",
            venue: "wdoor",
            event: "floodgate-300-10F",
        });

        const first = studyChildNodeId(doc.tree.rootId, "7g7f");
        const second = studyChildNodeId(first, "3c3d");
        const third = studyChildNodeId(second, "2g2f");
        expect(Object.keys(doc.tree.nodes)).toHaveLength(4);
        expect(doc.tree.nodes[first].source).toEqual({
            kind: "csa",
            score: { kind: "cp", value: 120 },
            pv: ["3c3d", "2g2f"],
            elapsedMs: 1000,
        });
        // ±100000 は手数不明の詰み。
        expect(doc.tree.nodes[second].source).toEqual({
            kind: "csa",
            score: { kind: "mate", winner: "sente", plies: null },
            pv: null,
            elapsedMs: 2000,
        });
        expect(doc.tree.nodes[third].source).toEqual({
            kind: "csa",
            score: null,
            pv: null,
            elapsedMs: 0,
        });
    });

    it("表題を指定できる。指せない手を含む棋譜は例外", () => {
        const doc = createStudyDocumentFromCsa({
            id: "study",
            csa: CSA_HIRATE,
            origin: { kind: "paste", ref: null },
            title: "研究用",
        });
        expect(doc.title).toBe("研究用");
        expect(() =>
            createStudyDocumentFromCsa({
                id: "study",
                csa: "PI\n+\n+7775FU\n",
                origin: { kind: "paste", ref: null },
            }),
        ).toThrow();
    });
});

describe("generateStudyId", () => {
    it("UUID v4 を返す", () => {
        expect(generateStudyId()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });
});
