import { describe, expect, it } from "vitest";
import { applyMoveWithState, createInitialPositionState } from "../game/board";
import { parseStudySfen } from "../study/sfen";
import { applyUsiMoveStrict } from "./usi-move";

describe("applyUsiMoveStrict", () => {
    it.each([
        ["4k4/9/4P4/9/9/9/9/9/4K4 b -", "5c5b+"],
        ["4k4/9/4P4/9/9/9/9/9/4K4 b -", "5c5b"],
        ["4k4/9/4+P4/9/9/9/9/9/4K4 b -", "5c4c"],
        ["4k4/9/9/9/9/9/9/9/4K4 b P", "P*5e"],
        ["4k4/9/9/9/9/9/4p4/9/4K4 w -", "5g5h+"],
        ["4k4/9/9/9/9/9/4p4/9/4K4 w -", "5g5h"],
        ["4k4/9/9/9/9/9/9/9/4K4 w p", "P*5e"],
    ])("合法手を適用し入力を変更しない: %s %s", (sfen, move) => {
        const state = parseStudySfen(sfen);
        const before = structuredClone(state);
        expect(applyUsiMoveStrict(state, move)).toEqual({
            ok: true,
            next: applyMoveWithState(state, move).next,
        });
        expect(state).toEqual(before);
    });

    it.each([
        "7g7e",
        "8h3c",
        "7g7f+",
        "3c3d",
        "5e5d",
        "pass",
        "resign",
        "invalid",
    ])("初期局面で指せない手を拒否する: %s", (move) =>
        expect(applyUsiMoveStrict(createInitialPositionState(), move).ok).toBe(false));

    it.each([
        ["4k4/9/9/9/9/9/4P4/9/4K4 b P", "P*5e"],
        ["k3r4/9/9/9/9/9/P8/9/4K4 b -", "9g9f"],
        ["k8/4P4/9/9/9/9/9/9/4K4 b -", "5b5a"],
        ["4k4/9/9/9/9/9/9/9/4K4 b P", "P*1a"],
        ["4k4/9/9/9/9/9/9/9/4K4 b -", "P*5e"],
        ["4k4/9/4+P4/9/9/9/9/9/4K4 b -", "5c4c+"],
        ["4k4/9/4G4/9/9/9/9/9/4K4 b -", "5c5b+"],
    ])("違法手を拒否し入力を変更しない: %s %s", (sfen, move) => {
        const state = parseStudySfen(sfen);
        const before = structuredClone(state);
        expect(applyUsiMoveStrict(state, move)).toEqual({ ok: false });
        expect(state).toEqual(before);
    });
});

describe("applyUsiMoveStrict: 合法手の数", () => {
    const files = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const ranks = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const squares = files.flatMap((file) => ranks.map((rank) => `${file}${rank}`));
    const candidates = [
        ...squares.flatMap((from) => squares.flatMap((to) => [`${from}${to}`, `${from}${to}+`])),
        ...["P", "L", "N", "S", "G", "B", "R"].flatMap((piece) =>
            squares.map((to) => `${piece}*${to}`),
        ),
    ];

    // 全駒種の動き・成り・駒打ちで、合法手を誤って拒否しないことを既知の合法手数で確かめる。
    it.each([
        ["lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -", 30],
        ["R8/2K1S1SSk/4B4/9/9/9/9/9/1L1L1L3 b RBGSNLP3g3n17p", 593],
        ["l6nl/5+P1gk/2np1S3/p1p4Pp/3P2Sp1/1PPb2P1P/P5GS1/R8/LN4bKL w GR5pnsg", 207],
    ])("%s は %i 手", (sfen, count) => {
        const state = parseStudySfen(sfen);
        expect(candidates.filter((move) => applyUsiMoveStrict(state, move).ok)).toHaveLength(count);
    });
});
