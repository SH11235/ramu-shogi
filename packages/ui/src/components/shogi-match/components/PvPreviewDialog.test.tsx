import { createInitialPositionState } from "@shogi/app-core";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PvPreviewDialog } from "./PvPreviewDialog";

describe("PvPreviewDialog の持ち駒", () => {
    it("盤面の画面と同じく、持っている駒だけを出す", () => {
        const initial = createInitialPositionState();
        const startPosition = {
            ...initial,
            hands: { ...initial.hands, sente: { ...initial.hands.sente, B: 1 } },
        };
        render(
            <PvPreviewDialog
                onClose={() => {}}
                pv={["7g7f"]}
                startPosition={startPosition}
                ply={1}
            />,
        );

        const hands = screen.getAllByTestId("hand-pieces-actual");
        expect(hands).toHaveLength(1);
        const hand = hands[0] as HTMLElement;
        expect(within(hand).getByAltText("先手の角")).toBeDefined();
        expect(within(hand).queryByAltText("先手の飛")).toBeNull();
    });
});

describe("PvPreviewDialog の盤の向き", () => {
    it("開いた画面の盤が反転していれば、後手を手前にして描く", () => {
        render(
            <PvPreviewDialog
                onClose={() => {}}
                pv={["7g7f"]}
                startPosition={createInitialPositionState()}
                ply={1}
                flipBoard
            />,
        );

        const cells = [...screen.getByRole("dialog").querySelectorAll("[data-square]")];
        expect(cells[0]?.getAttribute("data-square")).toBe("1i");
    });
});
