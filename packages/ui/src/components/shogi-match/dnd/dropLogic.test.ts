import type { BoardState, Hands, PositionState, Square } from "@shogi/app-core";
import { createInitialPositionState } from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import { applyDrop, applyDropResult, validateDrop } from "./dropLogic";
import type { DragOrigin, DragPayload, DropResult, DropTarget } from "./types";

// テスト用ヘルパー
const createEmptyBoard = (): BoardState => {
    const squares: Square[] = [];
    const files = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];
    const ranks = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    for (const rank of ranks) {
        for (const file of files) {
            squares.push(`${file}${rank}` as Square);
        }
    }
    return Object.fromEntries(squares.map((sq) => [sq, null])) as BoardState;
};

const createEmptyHands = (): Hands => ({ sente: {}, gote: {} });

const createEmptyPosition = (): PositionState => ({
    board: createEmptyBoard(),
    hands: createEmptyHands(),
    turn: "sente",
    ply: 1,
});

describe("dropLogic", () => {
    describe("validateDrop", () => {
        it("削除は許可される（通常の駒）", () => {
            const position = createEmptyPosition();
            const origin: DragOrigin = { type: "board", square: "5e" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "delete" };

            const result = validateDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
        });

        it("玉は削除できない", () => {
            const position = createEmptyPosition();
            position.board["5i"] = { owner: "sente", type: "K" };

            const origin: DragOrigin = { type: "board", square: "5i" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "K",
                isPromoted: false,
            };
            const target: DropTarget = { type: "delete" };

            const result = validateDrop(origin, payload, target, position);

            expect(result.ok).toBe(false);
            expect(result.error).toBe("玉は削除できません");
        });

        it("盤上から盤上への移動を許可する", () => {
            const position = createEmptyPosition();
            position.board["5e"] = { owner: "sente", type: "P" };

            const origin: DragOrigin = { type: "board", square: "5e" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "board", square: "5d" };

            const result = validateDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
        });

        it("自分の駒がある場所への配置を拒否する", () => {
            const position = createEmptyPosition();
            position.board["5e"] = { owner: "sente", type: "P" };
            position.board["5d"] = { owner: "sente", type: "G" };

            const origin: DragOrigin = { type: "board", square: "5e" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "board", square: "5d" };

            const result = validateDrop(origin, payload, target, position);

            expect(result.ok).toBe(false);
            expect(result.error).toBe("自分の駒がある場所には置けません");
        });

        it("同じ場所への移動は許可する（キャンセル扱い）", () => {
            const position = createEmptyPosition();
            position.board["5e"] = { owner: "sente", type: "P" };

            const origin: DragOrigin = { type: "board", square: "5e" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "board", square: "5e" };

            const result = validateDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
        });

        it("敵の駒がある場所への移動を許可する", () => {
            const position = createEmptyPosition();
            position.board["5e"] = { owner: "sente", type: "P" };
            position.board["5d"] = { owner: "gote", type: "P" };

            const origin: DragOrigin = { type: "board", square: "5e" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "board", square: "5d" };

            const result = validateDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
        });

        it("持ち駒から盤上への配置を許可する", () => {
            const position = createEmptyPosition();
            position.hands.sente.P = 1;

            const origin: DragOrigin = { type: "hand", owner: "sente", pieceType: "P" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "board", square: "5e" };

            const result = validateDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
        });

        it("盤上から持ち駒エリアへの移動を許可する", () => {
            const position = createEmptyPosition();
            position.board["5e"] = { owner: "sente", type: "P" };

            const origin: DragOrigin = { type: "board", square: "5e" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "hand", owner: "sente" };

            const result = validateDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
        });

        it("持ち駒から持ち駒への移動を拒否する", () => {
            const position = createEmptyPosition();
            position.hands.sente.P = 1;

            const origin: DragOrigin = { type: "hand", owner: "sente", pieceType: "P" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "hand", owner: "gote" };

            const result = validateDrop(origin, payload, target, position);

            expect(result.ok).toBe(false);
            expect(result.error).toBe("持ち駒から持ち駒への移動はできません");
        });

        it("玉は1枚までの制限を検証する", () => {
            const position = createEmptyPosition();
            position.board["5i"] = { owner: "sente", type: "K" };

            const origin: DragOrigin = { type: "stock", owner: "sente", pieceType: "K" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "K",
                isPromoted: false,
            };
            const target: DropTarget = { type: "board", square: "5h" };

            const result = validateDrop(origin, payload, target, position);

            expect(result.ok).toBe(false);
            expect(result.error).toBe("玉はそれぞれ1枚までです");
        });

        // 平手の初期局面では、どの駒も一組ぶんが盤上に出そろっている。
        // 上限を持ち主ごとに数えると「先手の角は 1 枚だからもう 1 枚置ける」と通してしまい、
        // 合計 3 枚の局面になってエンジン側の検証（合計で数える）に弾かれていた。
        it.each([
            ["sente", "B", "角は先手・後手あわせて最大2枚までです。"],
            ["gote", "B", "角は先手・後手あわせて最大2枚までです。"],
            ["sente", "R", "飛は先手・後手あわせて最大2枚までです。"],
            ["sente", "G", "金は先手・後手あわせて最大4枚までです。"],
            ["gote", "P", "歩は先手・後手あわせて最大18枚までです。"],
        ] as const)("平手の初期局面で駒箱の %s の %s を盤に置くのは拒否する", (owner, pieceType, message) => {
            const position = createInitialPositionState();
            const origin: DragOrigin = { type: "stock", owner, pieceType };
            const payload: DragPayload = { owner, pieceType, isPromoted: false };
            const target: DropTarget = { type: "board", square: "5e" };

            expect(validateDrop(origin, payload, target, position)).toEqual({
                ok: false,
                error: message,
            });
            const applied = applyDrop(origin, payload, target, position);
            expect(applied.ok).toBe(false);
            expect(applied.next).toBe(position);
        });

        it("盤上の駒を1枚外したあとは、駒箱から同じ種類を置ける", () => {
            const position = createInitialPositionState();
            position.board["2b"] = null; // 後手の角を外す
            const origin: DragOrigin = { type: "stock", owner: "sente", pieceType: "B" };
            const payload: DragPayload = { owner: "sente", pieceType: "B", isPromoted: false };

            const result = validateDrop(origin, payload, { type: "board", square: "5e" }, position);

            expect(result.ok).toBe(true);
        });

        it("持ち駒から盤上へ置くのは、枚数が上限ちょうどでも許可する（総数は変わらない）", () => {
            const position = createInitialPositionState();
            // 先手の角が後手の角を取った形: 先手は盤上 1 枚＋持ち駒 1 枚で、合計は上限の 2 枚
            position.board["2b"] = null;
            position.hands.sente.B = 1;
            const origin: DragOrigin = { type: "hand", owner: "sente", pieceType: "B" };
            const payload: DragPayload = { owner: "sente", pieceType: "B", isPromoted: false };
            const target: DropTarget = { type: "board", square: "5e" };

            const applied = applyDrop(origin, payload, target, position);

            expect(applied.ok).toBe(true);
            expect(applied.next.board["5e"]).toEqual({ owner: "sente", type: "B" });
            expect(applied.next.hands.sente.B).toBeUndefined();
        });

        it("玉を持ち駒エリアへ移すのは拒否する", () => {
            const position = createInitialPositionState();
            const origin: DragOrigin = { type: "board", square: "5i" };
            const payload: DragPayload = { owner: "sente", pieceType: "K", isPromoted: false };

            const result = validateDrop(
                origin,
                payload,
                { type: "hand", owner: "sente" },
                position,
            );

            expect(result).toEqual({ ok: false, error: "玉は持ち駒にできません" });
        });

        it("相手の玉がいるマスへ置くのは拒否する", () => {
            const position = createInitialPositionState();
            const origin: DragOrigin = { type: "board", square: "5g" };
            const payload: DragPayload = { owner: "sente", pieceType: "P", isPromoted: false };

            const result = validateDrop(origin, payload, { type: "board", square: "5a" }, position);

            expect(result).toEqual({ ok: false, error: "玉は取れません" });
        });
    });

    describe("applyDrop", () => {
        it("盤上から盤上への移動を適用する", () => {
            const position = createEmptyPosition();
            position.board["5e"] = { owner: "sente", type: "P" };

            const origin: DragOrigin = { type: "board", square: "5e" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "board", square: "5d" };

            const result = applyDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
            expect(result.next.board["5e"]).toBeNull();
            expect(result.next.board["5d"]).toEqual({ owner: "sente", type: "P" });
        });

        it("敵の駒を取って持ち駒に追加する", () => {
            const position = createEmptyPosition();
            position.board["5e"] = { owner: "sente", type: "R" };
            position.board["5d"] = { owner: "gote", type: "P" };

            const origin: DragOrigin = { type: "board", square: "5e" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "R",
                isPromoted: false,
            };
            const target: DropTarget = { type: "board", square: "5d" };

            const result = applyDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
            expect(result.next.board["5e"]).toBeNull();
            expect(result.next.board["5d"]).toEqual({ owner: "sente", type: "R" });
            expect(result.next.hands.sente.P).toBe(1);
        });

        it("削除を適用する", () => {
            const position = createEmptyPosition();
            position.board["5e"] = { owner: "sente", type: "P" };

            const origin: DragOrigin = { type: "board", square: "5e" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "delete" };

            const result = applyDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
            expect(result.next.board["5e"]).toBeNull();
        });

        it("持ち駒エリアへの移動を適用する", () => {
            const position = createEmptyPosition();
            position.board["5e"] = { owner: "sente", type: "P", promoted: true };

            const origin: DragOrigin = { type: "board", square: "5e" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: true,
            };
            const target: DropTarget = { type: "hand", owner: "sente" };

            const result = applyDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
            expect(result.next.board["5e"]).toBeNull();
            expect(result.next.hands.sente.P).toBe(1);
        });

        it("持ち駒から盤上への配置を適用する", () => {
            const position = createEmptyPosition();
            position.hands.sente.P = 2;

            const origin: DragOrigin = { type: "hand", owner: "sente", pieceType: "P" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "board", square: "5e" };

            const result = applyDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
            expect(result.next.board["5e"]).toEqual({ owner: "sente", type: "P" });
            expect(result.next.hands.sente.P).toBe(1);
        });

        it("同じ場所への移動は元に戻す", () => {
            const position = createEmptyPosition();
            position.board["5e"] = { owner: "sente", type: "P" };

            const origin: DragOrigin = { type: "board", square: "5e" };
            const payload: DragPayload = {
                owner: "sente",
                pieceType: "P",
                isPromoted: false,
            };
            const target: DropTarget = { type: "board", square: "5e" };

            const result = applyDrop(origin, payload, target, position);

            expect(result.ok).toBe(true);
            expect(result.next.board["5e"]).toEqual({ owner: "sente", type: "P" });
        });
    });

    describe("applyDropResult", () => {
        it("DropResult からドロップを適用する", () => {
            const position = createEmptyPosition();
            position.board["5e"] = { owner: "sente", type: "P" };

            const dropResult: DropResult = {
                origin: { type: "board", square: "5e" },
                payload: { owner: "sente", pieceType: "P", isPromoted: false },
                target: { type: "board", square: "5d" },
            };

            const result = applyDropResult(dropResult, position);

            expect(result.ok).toBe(true);
            expect(result.next.board["5e"]).toBeNull();
            expect(result.next.board["5d"]).toEqual({ owner: "sente", type: "P" });
        });
    });
});
