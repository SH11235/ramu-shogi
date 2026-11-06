import { describe, expect, it } from "vitest";
import type { SelfplayJsonlGame, SelfplayJsonlMeta } from "../game/selfplay-jsonl";
import {
    createStudyDocumentFromSelfplayGame,
    SELFPLAY_JSONL_SOURCE_KIND,
    selfplayGameMeta,
    selfplayMoveComment,
} from "./selfplay-import";
import { STUDY_LIMITS } from "./types";

const START = "l1sg3nl/1r3kg2/p1npppsp1/2p3p1p/1p5P1/2P2PP1P/PPSPP1N2/5S1R1/LN1GKG2L b Bb 23";

const meta: SelfplayJsonlMeta = {
    timestamp: "2026-11-06T18:53:43+00:00",
    settings: {
        btime: 180000,
        wtime: 600000,
        binc: 2000,
        winc: 2000,
        threads: 184,
        hash_mb: 32768,
    },
    black: { label: "base", path: "/runs/engine-base.sh", options: ["EvalFile=a.bin", "Hash=16"] },
    white: { label: "test", path: "/runs/engine-test.sh", options: ["EvalFile=b.bin", "Hash=16"] },
};

const game: SelfplayJsonlGame = {
    gameId: 2,
    startSfen: START,
    moves: ["6i7h", "7a6b"],
    infos: [
        {
            engine: "test",
            elapsedMs: 7805,
            evalCp: 50,
            depth: 31,
            seldepth: 62,
            nodes: 545354529,
            nps: 69881410,
            timeMs: 7804,
            pv: ["7a6b"],
        },
        { engine: "base", mate: { winner: "gote", plies: 3 } },
    ],
    senteName: "test",
    goteName: "base",
    result: { outcome: "white_win", reason: "resign", winner: "base" },
};

describe("selfplayMoveComment", () => {
    it("探索の深さ・ノード数・NPS・探索時間を 1 行にする", () => {
        expect(selfplayMoveComment(game.infos[0], "b")).toBe(
            "▲test 深さ 31/62・ノード 545,354,529・NPS 69,881,410・探索 7.8秒",
        );
    });

    it("探索の情報が無ければ空", () => {
        expect(selfplayMoveComment({ engine: "base", elapsedMs: 10 }, "w")).toBe("");
    });
});

describe("selfplayGameMeta", () => {
    it("対局者・結果・持ち時間・エンジンの条件を meta にする（先後の入れ替えはラベルで引く）", () => {
        expect(selfplayGameMeta(game, meta, "pair.jsonl")).toEqual({
            blackName: "test",
            whiteName: "base",
            playedAt: "2026-11-06T18:53:43+00:00",
            event: "連続対局 第2局（pair.jsonl）",
            result: "WIN_WHITE",
            termination: "2手で後手の勝ち（投了）",
            timeControl: "先手 180秒+2秒 / 後手 600秒+2秒",
            searchSettings: "184 スレッド・ハッシュ 32768 MB",
            blackEngine: "engine-test.sh",
            whiteEngine: "engine-base.sh",
            engineOptionsDiff: "test: EvalFile=b.bin / base: EvalFile=a.bin",
            engineOptions: "Hash=16",
        });
    });

    it("長い USI オプションは meta の上限に収まるよう切り詰める", () => {
        const many = Array.from({ length: 2000 }, (_, i) => `Option${i}=${i}`);
        const big: SelfplayJsonlMeta = {
            ...meta,
            black: { ...meta.black, options: many },
            white: { ...meta.white, options: many },
        };
        const out = selfplayGameMeta(game, big);
        expect(new TextEncoder().encode(JSON.stringify(out)).length).toBeLessThanOrEqual(
            STUDY_LIMITS.metaBytes,
        );
        expect(out.engineOptions?.endsWith("…")).toBe(true);
        expect(out.engineOptionsDiff).toBe("なし（両者同じ）");
    });
});

describe("createStudyDocumentFromSelfplayGame", () => {
    it("評価値・読み筋・消費時間を source に、探索の情報をコメントに入れる", () => {
        const doc = createStudyDocumentFromSelfplayGame({
            id: "00000000-0000-4000-8000-000000000000",
            game,
            meta,
            origin: { kind: "paste", ref: null },
        });
        expect(doc.title).toBe("test 対 base（第2局）");
        expect(doc.startSfen).toBe(START);
        const root = doc.tree.nodes[doc.tree.rootId];
        const first = doc.tree.nodes[root.children[0]];
        const second = doc.tree.nodes[first.children[0]];
        expect(first.usiMove).toBe("6i7h");
        expect(first.source).toEqual({
            kind: SELFPLAY_JSONL_SOURCE_KIND,
            score: { kind: "cp", value: 50 },
            pv: ["7a6b"],
            elapsedMs: 7805,
        });
        expect(first.comment).toContain("▲test 深さ 31/62");
        expect(second.source?.score).toEqual({ kind: "mate", winner: "gote", plies: 3 });
        expect(second.comment).toBe("");
    });
});

describe("selfplayGameMeta の上限", () => {
    it('JSON にすると伸びる文字（ と "）を含むオプションも、保存する JSON の大きさで上限に収める', () => {
        const options = Array.from({ length: 2000 }, (_, i) => `Path${i}=C:dir\\"x"`);
        const out = selfplayGameMeta(game, {
            ...meta,
            black: { label: "test", options: [...options, "Only=black"] },
            white: { label: "base", options: [...options, ...options.map((o) => `${o}w`)] },
        });
        expect(new TextEncoder().encode(JSON.stringify(out)).length).toBeLessThanOrEqual(
            STUDY_LIMITS.metaBytes,
        );
        expect(out.termination).toBe("2手で後手の勝ち（投了）");
    });
});

describe("selfplayGameMeta の結果の無い局", () => {
    it("結果の行が無い局は、そう分かるように書く", () => {
        const { result: _omit, ...unfinished } = game;
        expect(selfplayGameMeta(unfinished, meta).termination).toBe("2手まで（結果の記録なし）");
    });
});
