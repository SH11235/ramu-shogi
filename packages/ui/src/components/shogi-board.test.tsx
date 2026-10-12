import { fireEvent, render } from "@testing-library/react";
import { Profiler, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ShogiBoard, type ShogiBoardCell, type ShogiBoardMoveShadow } from "./shogi-board";

const FILES = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];
const RANKS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

const grid: ShogiBoardCell[][] = RANKS.map((rank) =>
    FILES.map((file) => ({
        id: `${file}${rank}`,
        piece: `${file}${rank}` === "5c" ? { owner: "gote", type: "P" } : null,
    })),
);

const shadow: ShogiBoardMoveShadow = {
    piece: { owner: "sente", type: "P" },
    targets: new Set(["5e", "4e"]),
};

const square = (container: HTMLElement, id: string): HTMLElement => {
    const el = container.querySelector<HTMLElement>(`[data-square="${id}"]`);
    if (!el) throw new Error(`square ${id} not found`);
    return el;
};
const shadowSquares = (container: HTMLElement): string[] =>
    [...container.querySelectorAll<HTMLElement>("[data-move-shadow]")]
        .map((el) => el.dataset.square ?? "")
        .sort();

describe("ShogiBoard の駒の影", () => {
    it("影の指定が無い盤（閲覧専用など）には、影のマスも画像の変数も無い", () => {
        const { container } = render(<ShogiBoard grid={grid} />);
        expect(shadowSquares(container)).toEqual([]);
        expect(container.innerHTML).not.toContain("--shogi-move-shadow-image");
        expect(container.innerHTML).not.toContain("after:");
    });

    it("行き先のマスだけに印を付け、選んでいる駒の画像を盤のルートに 1 つ渡す", () => {
        const { container } = render(<ShogiBoard grid={grid} moveShadow={shadow} />);
        expect(shadowSquares(container)).toEqual(["4e", "5e"]);
        const root = container.firstElementChild as HTMLElement;
        expect(root.style.getPropertyValue("--shogi-move-shadow-image")).toBe(
            'url("/pieces/black_pawn.png")',
        );
        // 影は :hover のときだけ見せる。ホバーできる端末に限る
        const cls = square(container, "5e").className;
        expect(cls).toContain("after:opacity-0");
        expect(cls).toContain("[@media(hover:hover)]:hover:after:opacity-45");
        expect(square(container, "5d").className).not.toContain("after:");
    });

    it("駒の向きは盤上の駒と同じ規則（相手側の駒は逆さ）", () => {
        const upsideDown = (ui: ReactElement): boolean => {
            const { container, unmount } = render(ui);
            const result = square(container, "5e").className.includes("after:rotate-180");
            unmount();
            return result;
        };
        const gote: ShogiBoardMoveShadow = { ...shadow, piece: { owner: "gote", type: "P" } };
        expect(upsideDown(<ShogiBoard grid={grid} moveShadow={shadow} />)).toBe(false);
        expect(upsideDown(<ShogiBoard grid={grid} moveShadow={gote} />)).toBe(true);
        expect(upsideDown(<ShogiBoard grid={grid} moveShadow={shadow} flipBoard />)).toBe(true);
        expect(upsideDown(<ShogiBoard grid={grid} moveShadow={gote} flipBoard />)).toBe(false);
    });

    it("成り選択が出ている間は影を出さない", () => {
        const { container } = render(
            <ShogiBoard grid={grid} moveShadow={shadow} promotionSquare="5e" />,
        );
        expect(shadowSquares(container)).toEqual([]);
    });

    it("影を出している間にマウスを動かしても、React の再描画は起きない", () => {
        let commits = 0;
        const { container } = render(
            <Profiler
                id="board"
                onRender={() => {
                    commits += 1;
                }}
            >
                <ShogiBoard grid={grid} moveShadow={shadow} onSelect={() => {}} />
            </Profiler>,
        );
        expect(commits).toBe(1);

        for (const row of grid) {
            for (const cell of row) {
                const el = square(container, cell.id);
                fireEvent.pointerEnter(el);
                fireEvent.pointerMove(el, { clientX: 10, clientY: 10 });
                fireEvent.mouseEnter(el);
                fireEvent.mouseOver(el);
                fireEvent.mouseMove(el, { clientX: 12, clientY: 12 });
                fireEvent.mouseOut(el);
                fireEvent.mouseLeave(el);
                fireEvent.pointerLeave(el);
            }
        }
        expect(commits).toBe(1);
    });
});
