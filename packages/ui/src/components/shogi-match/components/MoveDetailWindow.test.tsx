import { createInitialPositionState } from "@shogi/app-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EvalGraphModal } from "./EvalGraphModal";
import { MoveDetailWindow } from "./MoveDetailWindow";

function windowElement(): HTMLElement {
    const element = screen.getByRole("toolbar", { name: "ウィンドウ移動ハンドル" }).parentElement;
    if (!element) throw new Error("ウィンドウが見つからない");
    return element;
}

describe("MoveDetailWindow", () => {
    it("見出しの帯に手の情報を出し、閉じるボタンで閉じる", () => {
        const onClose = vi.fn();
        render(
            <MoveDetailWindow
                move={{
                    ply: 1,
                    kifText: "▲７六歩(77)",
                    displayText: "☗7六歩(77)",
                    usiMove: "7g7f",
                    elapsedMs: 3000,
                }}
                position={createInitialPositionState()}
                onClose={onClose}
            />,
        );
        const toolbar = screen.getByRole("toolbar", { name: "ウィンドウ移動ハンドル" });
        expect(toolbar.textContent).toContain("詳細");
        expect(toolbar.textContent).toContain("1手目");
        expect(toolbar.textContent).toContain("☗7六歩(77)");
        expect(windowElement().style.width).toBe("320px");
        expect(windowElement().className).toContain("z-window");
        fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe("EvalGraphModal", () => {
    it("閉じている間は描かず、開くと 600x400 の窓に評価値推移を出す", () => {
        const props = { evalHistory: [], currentPly: 0, onClose: () => {} };
        const { rerender } = render(<EvalGraphModal {...props} open={false} />);
        expect(screen.queryByRole("toolbar")).toBeNull();
        rerender(<EvalGraphModal {...props} open />);
        expect(screen.getByText("評価値推移")).toBeTruthy();
        expect(windowElement().style.width).toBe("600px");
        expect(windowElement().style.height).toBe("400px");
    });
});
