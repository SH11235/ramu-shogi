import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../tooltip";
import { StudyNavBar } from "./StudyNavBar";

function renderNavBar(props: { index: number; total: number; compact?: boolean }) {
    const onBackTen = vi.fn();
    const onForwardTen = vi.fn();
    render(
        <TooltipProvider>
            <StudyNavBar
                index={props.index}
                total={props.total}
                onToStart={vi.fn()}
                onBack={vi.fn()}
                onForward={vi.fn()}
                onToEnd={vi.fn()}
                onBackTen={onBackTen}
                onForwardTen={onForwardTen}
                compact={props.compact}
            />
        </TooltipProvider>,
    );
    return { onBackTen, onForwardTen };
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("StudyNavBar の 10 手の移動", () => {
    it("10 手戻る・10 手進むを押すと、それぞれを呼ぶ", () => {
        const { onBackTen, onForwardTen } = renderNavBar({ index: 15, total: 30 });
        fireEvent.click(button("10 手戻る"));
        fireEvent.click(button("10 手進む"));
        expect(onBackTen).toHaveBeenCalledTimes(1);
        expect(onForwardTen).toHaveBeenCalledTimes(1);
    });

    it("最初・最後の局面では、その向きの 10 手の移動を押せない", () => {
        renderNavBar({ index: 0, total: 30 });
        expect(button("10 手戻る").disabled).toBe(true);
        expect(button("10 手進む").disabled).toBe(false);
    });

    it("スマートフォンの詰めた行（compact）には出さない", () => {
        renderNavBar({ index: 15, total: 30, compact: true });
        expect(screen.queryByRole("button", { name: "10 手戻る" })).toBeNull();
        expect(screen.queryByRole("button", { name: "10 手進む" })).toBeNull();
    });
});
