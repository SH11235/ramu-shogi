import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvalPanel } from "./EvalPanel";

vi.mock("./EvalGraph", () => ({ EvalGraph: () => <div data-testid="eval-graph" /> }));
vi.mock("./EvalGraphModal", () => ({ EvalGraphModal: () => null }));

afterEach(cleanup);

const toggle = () => screen.queryByRole("button", { name: /評価値グラフ/ });

describe("EvalPanel", () => {
    it("何も指定しなければ閉じていて、見出しを押すと開く", () => {
        render(<EvalPanel evalHistory={[]} currentPly={0} />);

        expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
        expect(screen.getByText("（クリックで展開）")).toBeTruthy();

        fireEvent.click(toggle() as HTMLElement);
        expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
        expect(screen.queryByText("（クリックで展開）")).toBeNull();
    });

    it("initialOpen なら最初から開いていて、見出しを押すと閉じられる", () => {
        render(<EvalPanel evalHistory={[]} currentPly={0} initialOpen />);

        expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
        fireEvent.click(toggle() as HTMLElement);
        expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    });

    it("collapsible=false なら常に開いていて、折りたたみの操作を出さない", () => {
        const { container } = render(
            <EvalPanel evalHistory={[]} currentPly={0} collapsible={false} />,
        );

        expect(screen.getByText("評価値グラフ")).toBeTruthy();
        expect(screen.getByTestId("eval-graph")).toBeTruthy();
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.queryByText("（クリックで展開）")).toBeNull();
        expect(container.querySelector("[aria-expanded]")).toBeNull();
        expect(container.querySelector("svg")).toBeNull();
        // グラフの枠は開いた状態の行高になっている。
        expect(container.querySelector(".grid-rows-\\[1fr\\]")).not.toBeNull();
        expect(container.querySelector(".grid-rows-\\[0fr\\]")).toBeNull();
    });
});
