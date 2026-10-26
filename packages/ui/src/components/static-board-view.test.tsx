import { createInitialPositionState } from "@shogi/app-core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StaticBoardView } from "./static-board-view";

const squares = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("[data-square]")].map(
        (cell) => cell.getAttribute("data-square") ?? "",
    );

const handOwners = (): string[] =>
    screen
        .getAllByRole("button", { name: /の飛 \d+枚$/ })
        .map((button) => button.getAttribute("aria-label")?.slice(0, 2) ?? "");

describe("StaticBoardView", () => {
    it("反転しないときは先手を手前にし、後手の持ち駒を上に置く", () => {
        const { container } = render(<StaticBoardView position={createInitialPositionState()} />);
        expect(squares(container).slice(0, 2)).toEqual(["9a", "8a"]);
        expect(handOwners()).toEqual(["後手", "先手"]);
    });

    it("反転すると盤の並びを逆にし、先手の持ち駒を上に置く", () => {
        const { container } = render(
            <StaticBoardView position={createInitialPositionState()} flipBoard />,
        );
        expect(squares(container).slice(0, 2)).toEqual(["1i", "2i"]);
        expect(handOwners()).toEqual(["先手", "後手"]);
    });

    it("持ち駒は選べない", () => {
        const initial = createInitialPositionState();
        render(
            <StaticBoardView
                position={{ ...initial, hands: { ...initial.hands, sente: { R: 1 } } }}
            />,
        );
        expect(screen.getByRole("button", { name: "先手の飛 1枚" })).toHaveProperty(
            "disabled",
            true,
        );
    });

    it("置き場所に合わせないときは、盤と持ち駒に既定のマスの大きさを渡す", () => {
        const { container } = render(<StaticBoardView position={createInitialPositionState()} />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.style.getPropertyValue("--shogi-cell-size")).toBe("48px");
    });
});
