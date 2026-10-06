import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PositionPresetSelector } from "./PositionPresetSelector";

const SFEN = "4k4/9/4p4/9/9/9/4P4/9/4K4 w - 1";

function renderCustomInput(onChange: (sfen: string) => void): HTMLInputElement {
    render(<PositionPresetSelector value={SFEN} onChange={onChange} />);
    return screen.getByPlaceholderText(/^例: lnsgkgsnl/) as HTMLInputElement;
}

describe("PositionPresetSelector の SFEN 直接入力", () => {
    it("前後の空白を除き、フィールドの間を 1 つの空白にそろえて通知する", () => {
        const onChange = vi.fn();
        const input = renderCustomInput(onChange);
        const typed = "  4k4/9/4p4/9/9/9/4P4/9/4K4  w\t-   1 ";

        fireEvent.change(input, { target: { value: typed } });

        expect(onChange).toHaveBeenLastCalledWith(SFEN);
        // 入力欄は打ったままにして、入力途中の空白を消さない
        expect(input.value).toBe(typed);
    });

    it("そろえる必要の無い SFEN はそのまま通知する", () => {
        const onChange = vi.fn();
        const input = renderCustomInput(onChange);

        fireEvent.change(input, { target: { value: "4k4/9/9/9/9/9/9/9/4K4 b 2P 1" } });

        expect(onChange).toHaveBeenLastCalledWith("4k4/9/9/9/9/9/9/9/4K4 b 2P 1");
    });

    it("手数を省いた入力は補わずに通知する", () => {
        const onChange = vi.fn();
        const input = renderCustomInput(onChange);

        fireEvent.change(input, { target: { value: "4k4/9/9/9/9/9/9/9/4K4 b - " } });

        expect(onChange).toHaveBeenLastCalledWith("4k4/9/9/9/9/9/9/9/4K4 b -");
    });

    it("入力途中の不正な SFEN は通知しない", () => {
        const onChange = vi.fn();
        const input = renderCustomInput(onChange);

        fireEvent.change(input, { target: { value: "4k4/9/4p4 " } });

        expect(onChange).not.toHaveBeenCalled();
    });
});
