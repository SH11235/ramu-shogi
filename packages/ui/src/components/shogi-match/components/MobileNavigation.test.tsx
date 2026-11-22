import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileNavigation } from "./MobileNavigation";

function renderNav(props: { currentPly: number; totalPly: number; center?: React.ReactNode }) {
    const handlers = {
        onToStart: vi.fn(),
        onBackTen: vi.fn(),
        onBack: vi.fn(),
        onForward: vi.fn(),
        onForwardTen: vi.fn(),
        onToEnd: vi.fn(),
    };
    render(<MobileNavigation {...props} {...handlers} />);
    return handlers;
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("MobileNavigation", () => {
    it("手送りの 6 つのボタンと手数だけを並べ、押すとそれぞれを呼ぶ", () => {
        const handlers = renderNav({ currentPly: 15, totalPly: 30 });
        expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
            "最初へ",
            "10手戻る",
            "1手戻る",
            "1手進む",
            "10手進む",
            "最後へ",
        ]);
        expect(screen.getByText("15/30")).toBeTruthy();
        fireEvent.click(button("10手戻る"));
        fireEvent.click(button("10手進む"));
        expect(handlers.onBackTen).toHaveBeenCalledTimes(1);
        expect(handlers.onForwardTen).toHaveBeenCalledTimes(1);
    });

    it("端の局面では、その向きのボタンを押せない", () => {
        renderNav({ currentPly: 0, totalPly: 30 });
        expect(button("最初へ").disabled).toBe(true);
        expect(button("10手戻る").disabled).toBe(true);
        expect(button("10手進む").disabled).toBe(false);
    });

    it("center を渡すと、手数の代わりにそれを置く", () => {
        renderNav({ currentPly: 4, totalPly: 30, center: <button type="button">本譜へ</button> });
        expect(screen.queryByText("4/30")).toBeNull();
        expect(screen.getByRole("button", { name: "本譜へ" })).toBeTruthy();
    });
});
