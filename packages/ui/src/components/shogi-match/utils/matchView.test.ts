import { createInitialPositionState } from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import { canEditPosition, resolveMoveDetail, shouldFlipBoardForSides } from "./matchView";

describe("resolveMoveDetail", () => {
    const move = (ply: number) => ({ ply, kifText: "", displayText: `m${ply}`, usiMove: "" });
    const positions = [createInitialPositionState(), createInitialPositionState()];
    const kifMoves = [move(1), move(2)];

    it("開いている間は、見ている手と、その手数の局面を返す", () => {
        const detail = resolveMoveDetail({
            isOpen: true,
            currentPly: 2,
            kifMoves,
            positionHistory: positions,
        });
        expect(detail?.move.ply).toBe(2);
        expect(detail?.position).toBe(positions[1]);
    });

    it("閉じている間と、開始局面（0 手目）では出さない", () => {
        expect(
            resolveMoveDetail({
                isOpen: false,
                currentPly: 2,
                kifMoves,
                positionHistory: positions,
            }),
        ).toBeNull();
        expect(
            resolveMoveDetail({
                isOpen: true,
                currentPly: 0,
                kifMoves,
                positionHistory: positions,
            }),
        ).toBeNull();
    });
});

describe("canEditPosition", () => {
    it("通常の画面では、編集モードの間だけ局面を編集できる", () => {
        expect(canEditPosition({ isEditMode: true, viewerMode: false })).toBe(true);
        expect(canEditPosition({ isEditMode: false, viewerMode: false })).toBe(false);
    });

    it("ビューアでは、内部の状態が編集モードのまま残っていても編集できない", () => {
        // initialReview の取り込み前と、取り込みに失敗した後がこの状態。
        expect(canEditPosition({ isEditMode: true, viewerMode: true })).toBe(false);
        expect(canEditPosition({ isEditMode: false, viewerMode: true })).toBe(false);
    });
});

describe("shouldFlipBoardForSides", () => {
    it("対局画面では、後手だけが人間のときに盤を反転する", () => {
        const flip = (senteRole: "human" | "engine", goteRole: "human" | "engine") =>
            shouldFlipBoardForSides({ reviewMode: false, senteRole, goteRole });
        expect(flip("engine", "human")).toBe(true);
        expect(flip("human", "human")).toBe(false);
        expect(flip("human", "engine")).toBe(false);
        expect(flip("engine", "engine")).toBe(false);
    });

    it("棋譜を見る画面では、保存されている先後の設定にかかわらず先手を手前にする", () => {
        expect(
            shouldFlipBoardForSides({ reviewMode: true, senteRole: "engine", goteRole: "human" }),
        ).toBe(false);
    });
});
