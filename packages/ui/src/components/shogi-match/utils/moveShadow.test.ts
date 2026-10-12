import { describe, expect, it } from "vitest";
import type { ShogiBoardCell } from "../../shogi-board";
import { computeMoveShadow } from "./moveShadow";

const FILES = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];
const RANKS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

function makeGrid(pieces: Record<string, ShogiBoardCell["piece"]>): ShogiBoardCell[][] {
    return RANKS.map((rank) =>
        FILES.map((file) => ({ id: `${file}${rank}`, piece: pieces[`${file}${rank}`] ?? null })),
    );
}

const grid = makeGrid({
    "7g": { owner: "sente", type: "P" },
    "8h": { owner: "sente", type: "B", promoted: true },
});
// 歩は 2 マスにしか打てない想定（二歩などで打てないマスは、合法手の一覧に無い）
const legalMoves = ["7g7f", "8h7g", "8h2b", "8h2b+", "P*5e", "P*4e", "G*5e", "pass"];

describe("computeMoveShadow", () => {
    it("持ち駒は、その駒を打てるマスだけを対象にし、駒の持ち主は手番にする", () => {
        const shadow = computeMoveShadow({
            selection: { kind: "hand", piece: "P" },
            grid,
            turn: "gote",
            legalMoves,
        });
        expect(shadow?.piece).toEqual({ owner: "gote", type: "P" });
        expect([...(shadow?.targets ?? [])].sort()).toEqual(["4e", "5e"]);
    });

    it("盤上の駒は、その駒の行き先だけを対象にし、いまの駒の絵（成り）のままにする", () => {
        const shadow = computeMoveShadow({
            selection: { kind: "square", square: "8h" },
            grid,
            turn: "sente",
            legalMoves,
        });
        expect(shadow?.piece).toEqual({ owner: "sente", type: "B", promoted: true });
        // 成・不成の 2 手は同じマスにまとまる
        expect([...(shadow?.targets ?? [])].sort()).toEqual(["2b", "7g"]);
    });

    it("打つ手・パスを、盤上の駒の行き先と取り違えない", () => {
        const shadow = computeMoveShadow({
            selection: { kind: "square", square: "pa" },
            grid: makeGrid({ pa: { owner: "sente", type: "P" } }),
            turn: "sente",
            legalMoves: ["pass", "P*5e"],
        });
        expect(shadow).toBeNull();
    });

    it("選択なし・合法手が未取得・行き先なし・駒のないマスでは null", () => {
        expect(computeMoveShadow({ selection: null, grid, turn: "sente", legalMoves })).toBeNull();
        expect(
            computeMoveShadow({
                selection: { kind: "hand", piece: "P" },
                grid,
                turn: "sente",
                legalMoves: null,
            }),
        ).toBeNull();
        expect(
            computeMoveShadow({
                selection: { kind: "hand", piece: "L" },
                grid,
                turn: "sente",
                legalMoves,
            }),
        ).toBeNull();
        expect(
            computeMoveShadow({
                selection: { kind: "square", square: "5e" },
                grid,
                turn: "sente",
                legalMoves,
            }),
        ).toBeNull();
    });
});
