import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PositionPresetSelector } from "./PositionPresetSelector";

const SFEN = "4k4/9/4p4/9/9/9/4P4/9/4K4 w - 1";

function renderCustomInput(onChange: (sfen: string) => void): HTMLInputElement {
    render(<PositionPresetSelector value={SFEN} onChange={onChange} />);
    return screen.getByPlaceholderText(/^例: lnsgkgsnl/) as HTMLInputElement;
}

/** 通知された開始局面を value に反映する親 */
function Controlled({ onChange }: { onChange: (sfen: string) => void }): ReactElement {
    const [value, setValue] = useState(SFEN);
    return (
        <PositionPresetSelector
            value={value}
            onChange={(sfen) => {
                onChange(sfen);
                setValue(sfen);
            }}
        />
    );
}

function choose(label: string): void {
    fireEvent.keyDown(screen.getByRole("combobox", { name: "開始局面を選択" }), {
        key: "ArrowDown",
    });
    fireEvent.keyDown(screen.getByRole("option", { name: label }), { key: "Enter" });
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

    it("プリセットから SFEN 直接入力へ戻したときも、空白をそろえて通知する", () => {
        const onChange = vi.fn();
        render(<Controlled onChange={onChange} />);
        fireEvent.change(screen.getByPlaceholderText(/^例: lnsgkgsnl/), {
            target: { value: ` ${SFEN}  ` },
        });

        choose("平手");
        expect(onChange).toHaveBeenLastCalledWith("startpos");
        choose("SFEN 直接入力");

        expect(onChange).toHaveBeenLastCalledWith(SFEN);
    });

    it("入力欄が空のまま SFEN 直接入力へ切り替えたら、空を通知する", () => {
        const onChange = vi.fn();
        render(<PositionPresetSelector value="startpos" onChange={onChange} />);

        choose("SFEN 直接入力");

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith("");
    });

    it("入力途中の不正な SFEN を残したまま SFEN 直接入力へ戻したら、その文字列でなく空を通知する", () => {
        const onChange = vi.fn();
        render(<Controlled onChange={onChange} />);
        fireEvent.change(screen.getByPlaceholderText(/^例: lnsgkgsnl/), {
            target: { value: "4k4/9/4p4" },
        });

        choose("平手");
        choose("SFEN 直接入力");

        expect(onChange.mock.calls).toEqual([["startpos"], [""]]);
    });
});
