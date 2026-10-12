import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPlayHandoff, readPlayHandoff, savePlayHandoff } from "./playHandoff";

const KEY = "ramu_review_kifu";
const MIDGAME_SFEN = "ln1gk1snl/1r4g2/p1ppppspp/6p2/1p5P1/2P6/PPSPPPP1P/2G4R1/LN2KGSNL w Bb 1";

describe("playHandoff", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
    });

    it("置いた局面を、手順ごとそのまま読める", () => {
        expect(savePlayHandoff({ sfen: "startpos", moves: ["7g7f", "3c3d"] })).toBe(true);
        expect(readPlayHandoff()).toEqual({ sfen: "startpos", moves: ["7g7f", "3c3d"] });
    });

    it("平手以外・後手番開始の開始局面も、SFEN のまま渡る", () => {
        savePlayHandoff({ sfen: MIDGAME_SFEN, moves: ["B*5e"] });
        expect(readPlayHandoff()).toEqual({ sfen: MIDGAME_SFEN, moves: ["B*5e"] });
    });

    it("読んでも消えず、消すと読めなくなる", () => {
        savePlayHandoff({ sfen: "startpos", moves: [] });
        expect(readPlayHandoff()).toEqual({ sfen: "startpos", moves: [] });
        expect(readPlayHandoff()).toEqual({ sfen: "startpos", moves: [] });

        clearPlayHandoff();
        expect(readPlayHandoff()).toBeUndefined();
    });

    it("何も置かれていなければ undefined", () => {
        expect(readPlayHandoff()).toBeUndefined();
    });

    it.each([
        ["JSON でない", "not json"],
        ["オブジェクトでない", "42"],
        ["null", "null"],
        ["sfen が無い", JSON.stringify({ moves: [] })],
        ["sfen が空", JSON.stringify({ sfen: " ", moves: [] })],
        ["moves が配列でない", JSON.stringify({ sfen: "startpos", moves: "7g7f" })],
        ["moves に文字列以外がある", JSON.stringify({ sfen: "startpos", moves: ["7g7f", 1] })],
    ])("壊れた中身（%s）は読まない", (_label, raw) => {
        window.sessionStorage.setItem(KEY, raw);
        expect(readPlayHandoff()).toBeUndefined();
    });

    it("保存領域が使えないときは false を返す（例外にしない）", () => {
        // happy-dom の sessionStorage は Proxy で restoreAllMocks が効かないため Once で自己復帰させる
        vi.spyOn(window.sessionStorage, "setItem").mockImplementationOnce(() => {
            throw new Error("QuotaExceededError");
        });
        expect(savePlayHandoff({ sfen: "startpos", moves: [] })).toBe(false);
    });
});
