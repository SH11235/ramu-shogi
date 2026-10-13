import { createInitialPositionState } from "@shogi/app-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KifMove } from "../utils/kifFormat";
import { KifuPanel } from "./KifuPanel";

afterEach(cleanup);

const MOVES: KifMove[] = [
    { ply: 1, kifText: "▲７六歩(77)", displayText: "☗7六歩(77)", usiMove: "7g7f", pv: ["3c3d"] },
    { ply: 2, kifText: "△３四歩(33)", displayText: "☖3四歩(33)", usiMove: "3c3d" },
];

function renderPanel() {
    const onPlySelect = vi.fn();
    const onMoveDetailSelect = vi.fn();
    const position = createInitialPositionState();
    render(
        <KifuPanel
            kifMoves={MOVES}
            currentPly={0}
            onPlySelect={onPlySelect}
            positionHistory={[position, position]}
            onMoveDetailSelect={onMoveDetailSelect}
        />,
    );
    return { onPlySelect, onMoveDetailSelect, position };
}

describe("KifuPanel: 指し手の行と読み筋", () => {
    it("行を押すと、その局面へ移るだけで、読み筋は開かない", () => {
        const { onPlySelect, onMoveDetailSelect } = renderPanel();

        fireEvent.click(screen.getAllByRole("option")[0] as HTMLElement);

        expect(onPlySelect).toHaveBeenCalledWith(1);
        expect(onMoveDetailSelect).not.toHaveBeenCalled();
    });

    it("読み筋のある手は、行の右端のボタンで読み筋を開く（その局面へも移る）", () => {
        const { onPlySelect, onMoveDetailSelect, position } = renderPanel();

        fireEvent.click(screen.getByRole("button", { name: "1手目の読み筋を開く" }));

        expect(onPlySelect).toHaveBeenCalledTimes(1);
        expect(onPlySelect).toHaveBeenCalledWith(1);
        expect(onMoveDetailSelect).toHaveBeenCalledWith(MOVES[0], position);
        // 読み筋の無い手には、開くボタンを出さない。
        expect(screen.queryByRole("button", { name: "2手目の読み筋を開く" })).toBeNull();
    });

    it("読み筋のボタンでのキー操作は、行の操作にせず、外（矢印キーでの手送りなど）へも伝える", () => {
        const { onPlySelect } = renderPanel();
        const onDocumentKeyDown = vi.fn();
        document.addEventListener("keydown", onDocumentKeyDown);

        const toggle = screen.getByRole("button", { name: "1手目の読み筋を開く" });
        fireEvent.keyDown(toggle, { key: "Enter" });
        fireEvent.keyDown(toggle, { key: "ArrowRight" });

        document.removeEventListener("keydown", onDocumentKeyDown);
        // Enter は、ボタン自身の click に任せる（行の「移る」を重ねて呼ばない）。
        expect(onPlySelect).not.toHaveBeenCalled();
        expect(onDocumentKeyDown).toHaveBeenCalledTimes(2);
    });
});
