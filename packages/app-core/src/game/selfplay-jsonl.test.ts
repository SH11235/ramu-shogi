import { describe, expect, it } from "vitest";
import { looksLikeSelfplayJsonl, parseSelfplayJsonl } from "./selfplay-jsonl";

const START = "l1sg3nl/1r3kg2/p1npppsp1/2p3p1p/1p5P1/2P2PP1P/PPSPP1N2/5S1R1/LN1GKG2L b Bb 23";
const AFTER_1 = "l1sg3nl/1r3kg2/p1npppsp1/2p3p1p/1p5P1/2P2PP1P/PPSPP1N2/2G2S1R1/LN2KG2L w Bb 24";
const AFTER_2 = "l2g3nl/1r1s1kg2/p1npppsp1/2p3p1p/1p5P1/2P2PP1P/PPSPP1N2/2G2S1R1/LN2KG2L b Bb 25";

const row = (value: object): string => JSON.stringify(value);

const sampleLog = (): string =>
    [
        row({
            type: "meta",
            timestamp: "2026-11-06T18:53:43+00:00",
            settings: { btime: 180000, wtime: 600000, binc: 2000, winc: 2000, threads: 184 },
            engine_cmd: {
                path_black: "/runs/engine-base.sh",
                path_white: "/runs/engine-test.sh",
                label_black: "base",
                label_white: "test",
                usi_options_black: ["EvalFile=a.bin", "Threads=1"],
                usi_options_white: ["EvalFile=b.bin", "Threads=1"],
            },
        }),
        row({
            type: "move",
            game_id: 1,
            ply: 1,
            side_to_move: "b",
            sfen_before: START,
            move_usi: "6i7h",
            engine: "base",
            elapsed_ms: 7805,
            eval: {
                score_cp: 50,
                depth: 31,
                seldepth: 62,
                nodes: 545354529,
                time_ms: 7804,
                nps: 69881410,
                pv: ["6i7h", "7a6b"],
            },
        }),
        row({
            type: "move",
            game_id: 1,
            ply: 2,
            side_to_move: "w",
            sfen_before: AFTER_1,
            move_usi: "7a6b",
            engine: "test",
            elapsed_ms: 0,
            eval: { score_cp: -35, depth: 30, pv: ["7a6b"] },
        }),
        row({
            type: "move",
            game_id: 1,
            ply: 3,
            side_to_move: "b",
            sfen_before: AFTER_2,
            move_usi: "resign",
            engine: "base",
        }),
        row({
            type: "result",
            game_id: 1,
            outcome: "white_win",
            reason: "resign",
            plies: 3,
            winner: "test",
        }),
    ].join("\n");

describe("looksLikeSelfplayJsonl", () => {
    it("最初の行が type を持つ JSON なら JSONL とみなす", () => {
        expect(looksLikeSelfplayJsonl(sampleLog())).toBe(true);
        expect(looksLikeSelfplayJsonl('\n\n{"type":"move"}')).toBe(true);
    });

    it("KIF・SFEN・ただの JSON は JSONL とみなさない", () => {
        expect(looksLikeSelfplayJsonl("手合割：平手\n1 ７六歩(77)")).toBe(false);
        expect(looksLikeSelfplayJsonl("startpos moves 7g7f")).toBe(false);
        expect(looksLikeSelfplayJsonl('{"name":"x"}')).toBe(false);
        expect(looksLikeSelfplayJsonl("{not json")).toBe(false);
    });
});

describe("parseSelfplayJsonl", () => {
    it("対局ごとに開始局面・手順・探索の情報・結果をまとめる", () => {
        const log = parseSelfplayJsonl(sampleLog());
        expect(log.meta?.timestamp).toBe("2026-11-06T18:53:43+00:00");
        expect(log.meta?.settings.btime).toBe(180000);
        expect(log.meta?.black).toEqual({
            label: "base",
            path: "/runs/engine-base.sh",
            options: ["EvalFile=a.bin", "Threads=1"],
        });
        expect(log.games).toHaveLength(1);
        const [game] = log.games;
        expect(game.startSfen).toBe(START);
        // 投了の応答は盤上の手にしない。
        expect(game.moves).toEqual(["6i7h", "7a6b"]);
        expect(game.senteName).toBe("base");
        expect(game.goteName).toBe("test");
        expect(game.result).toEqual({ outcome: "white_win", reason: "resign", winner: "test" });
        expect(game.infos[0]).toEqual({
            engine: "base",
            elapsedMs: 7805,
            evalCp: 50,
            depth: 31,
            seldepth: 62,
            nodes: 545354529,
            nps: 69881410,
            timeMs: 7804,
            pv: ["7a6b"],
        });
    });

    it("後手の手番の評価値は符号を反転して先手から見た値にする", () => {
        const [game] = parseSelfplayJsonl(sampleLog()).games;
        expect(game.infos[1].evalCp).toBe(35);
        // 読み筋が指した手だけなら、指した後の読み筋は無い。
        expect(game.infos[1].pv).toBeUndefined();
    });

    it("詰みの評価値は詰ます側と手数にする", () => {
        const text = row({
            type: "move",
            game_id: 3,
            ply: 1,
            sfen_before: AFTER_1,
            move_usi: "7a6b",
            eval: { score_mate: -2 },
        });
        const [game] = parseSelfplayJsonl(text).games;
        expect(game.infos[0].mate).toEqual({ winner: "sente", plies: 2 });
    });

    it("時間切れのあとに届いた手は盤上の手にしない", () => {
        const text = [
            row({ type: "move", game_id: 2, ply: 1, sfen_before: START, move_usi: "6i7h" }),
            row({
                type: "move",
                game_id: 2,
                ply: 2,
                sfen_before: AFTER_1,
                move_usi: "7a6b",
                timed_out: true,
            }),
        ].join("\n");
        expect(parseSelfplayJsonl(text).games[0].moves).toEqual(["6i7h"]);
    });

    it("複数の対局を game_id の順に並べる", () => {
        const text = [
            row({ type: "move", game_id: 10, ply: 1, sfen_before: START, move_usi: "6i7h" }),
            row({ type: "move", game_id: 2, ply: 1, sfen_before: START, move_usi: "6i7h" }),
        ].join("\n");
        expect(parseSelfplayJsonl(text).games.map((game) => game.gameId)).toEqual([2, 10]);
    });

    it("読めない行は何行目かを添えて断る", () => {
        expect(() => parseSelfplayJsonl(`${row({ type: "meta" })}\n{broken`)).toThrow(
            "2 行目を JSON として読めません",
        );
        expect(() => parseSelfplayJsonl(row({ type: "move", game_id: 1 }))).toThrow(
            "1 行目の move に",
        );
    });
});
