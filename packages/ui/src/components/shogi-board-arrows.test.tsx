import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type ShogiBoardArrow, ShogiBoardArrows } from "./shogi-board-arrows";

const renderArrows = (arrows: ShogiBoardArrow[], flipBoard = false) =>
    render(<ShogiBoardArrows arrows={arrows} flipBoard={flipBoard} />).container;

describe("ShogiBoardArrows", () => {
    it("矢印の先は行き先のマスの中心で、盤を反転すると反対側のマスを指す", () => {
        const arrow: ShogiBoardArrow = {
            from: "7g",
            to: "7f",
            side: "sente",
            emphasis: "primary",
        };
        // 7 筋は左から 3 列目、f は上から 6 段目。
        expect(renderArrows([arrow]).querySelector("path")?.getAttribute("d")).toContain(
            "2.500 5.500",
        );
        expect(renderArrows([arrow], true).querySelector("path")?.getAttribute("d")).toContain(
            "6.500 3.500",
        );
    });

    it("色は指す側、第二候補を先に描いて第一候補を上に重ねる", () => {
        const container = renderArrows([
            { from: "7g", to: "7f", side: "gote", emphasis: "primary" },
            { from: "2g", to: "2f", side: "gote", emphasis: "secondary" },
        ]);
        const paths = [...container.querySelectorAll("path")];
        expect(paths.map((path) => path.dataset.arrow)).toEqual(["secondary", "primary"]);
        expect(paths.every((path) => path.classList.contains("fill-wafuu-ai"))).toBe(true);
        expect(paths.map((path) => path.getAttribute("fill-opacity"))).toEqual(["0.45", "0.8"]);
    });

    it("駒打ちは矢印にせず、行き先に輪と駒の影を描く", () => {
        const container = renderArrows([
            { from: null, to: "5e", side: "sente", emphasis: "primary", dropPiece: "B" },
        ]);
        expect(container.querySelector("path")).toBeNull();
        const circle = container.querySelector("circle");
        expect([circle?.getAttribute("cx"), circle?.getAttribute("cy")]).toEqual(["4.5", "4.5"]);
        expect(circle?.classList.contains("stroke-wafuu-shu")).toBe(true);
        expect(container.querySelector("image")).not.toBeNull();
    });

    it("読めないマスの手は描かない", () => {
        const container = renderArrows([
            { from: "7x", to: "7f", side: "sente", emphasis: "primary" },
        ]);
        expect(container.querySelectorAll("path, circle")).toHaveLength(0);
    });
});
