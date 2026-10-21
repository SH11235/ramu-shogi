import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { onlineStartSfenProblem, PositionPresetSelector } from "./PositionPresetSelector";

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
        expect(screen.getByText(/^有効な局面ではありません/)).toBeTruthy();
    });

    it("別の SFEN が value に届いたら、入力欄をその SFEN に置き換える", () => {
        const other = "4k4/9/9/9/9/9/9/9/4K4 b 2P 1";
        const { rerender } = render(<PositionPresetSelector value={SFEN} onChange={vi.fn()} />);
        const input = screen.getByPlaceholderText(/^例: lnsgkgsnl/) as HTMLInputElement;

        rerender(<PositionPresetSelector value={other} onChange={vi.fn()} />);

        expect(input.value).toBe(other);
    });

    it("打っている間に届いた value では置き換えず、入力欄を離れたときに合わせる", () => {
        const stale = "4k4/9/9/9/9/9/9/9/4K4 b 2P 1";
        const typed = "4k4/9/9/9/9/9/9/9/4K4 b 2P 12";
        const { rerender } = render(<PositionPresetSelector value={SFEN} onChange={vi.fn()} />);
        const input = screen.getByPlaceholderText(/^例: lnsgkgsnl/) as HTMLInputElement;

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: typed } });
        rerender(<PositionPresetSelector value={stale} onChange={vi.fn()} />);
        expect(input.value).toBe(typed);

        fireEvent.blur(input);
        expect(input.value).toBe(stale);
    });

    it("入力欄を離れても、打ちかけの不正な文字列を直前に通知した局面へ戻さない", () => {
        render(<Controlled onChange={vi.fn()} />);
        const input = screen.getByPlaceholderText(/^例: lnsgkgsnl/) as HTMLInputElement;

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "4k4/9/4p4" } });
        fireEvent.blur(input);

        expect(input.value).toBe("4k4/9/4p4");
        expect(screen.getByText(/^有効な局面ではありません/)).toBeTruthy();
    });

    it("外から届いた局面に合わせた後も、打ちかけの不正な文字列を入力欄を離れたときに残す", () => {
        const other = "4k4/9/9/9/9/9/9/9/4K4 b 2P 1";
        const { rerender } = render(<PositionPresetSelector value={SFEN} onChange={vi.fn()} />);
        rerender(<PositionPresetSelector value={other} onChange={vi.fn()} />);
        const input = screen.getByPlaceholderText(/^例: lnsgkgsnl/) as HTMLInputElement;
        expect(input.value).toBe(other);

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "4k4/9/9" } });
        fireEvent.blur(input);

        expect(input.value).toBe("4k4/9/9");
    });

    it("打っている間に外からプリセットへ切り替わっても、次に届いた SFEN を入力欄に反映する", () => {
        const other = "4k4/9/9/9/9/9/9/9/4K4 b 2P 1";
        const { rerender } = render(<PositionPresetSelector value={SFEN} onChange={vi.fn()} />);
        fireEvent.focus(screen.getByPlaceholderText(/^例: lnsgkgsnl/));

        rerender(<PositionPresetSelector value="startpos" onChange={vi.fn()} />);
        rerender(<PositionPresetSelector value={other} onChange={vi.fn()} />);

        expect((screen.getByPlaceholderText(/^例: lnsgkgsnl/) as HTMLInputElement).value).toBe(
            other,
        );
    });

    it("自分の入力を通知した結果の value では、打った文字列を残す", () => {
        const onChange = vi.fn();
        render(<Controlled onChange={onChange} />);
        const input = screen.getByPlaceholderText(/^例: lnsgkgsnl/) as HTMLInputElement;
        const typed = "  4k4/9/9/9/9/9/9/9/4K4  b 2P 1";

        fireEvent.change(input, { target: { value: typed } });
        expect(onChange).toHaveBeenLastCalledWith("4k4/9/9/9/9/9/9/9/4K4 b 2P 1");
        expect(input.value).toBe(typed);

        choose("平手");
        choose("SFEN 直接入力");
        expect((screen.getByPlaceholderText(/^例: lnsgkgsnl/) as HTMLInputElement).value).toBe(
            typed,
        );
    });

    it("入力欄が空のまま SFEN 直接入力へ切り替えても、入力を促すエラーはまだ出さない", () => {
        render(<PositionPresetSelector value="startpos" onChange={vi.fn()} />);

        choose("SFEN 直接入力");

        expect(screen.queryByText("局面（SFEN）を入力してください")).toBeNull();
    });
});

describe("onlineStartSfenProblem", () => {
    const FORMAT = "オンライン対局では読み取れない局面です。SFEN の書き方を確認してください";
    const KINGS = "オンライン対局では、先手と後手の玉が 1 枚ずつある局面だけ使えます";
    const PIECES =
        "駒が多すぎます。盤と持ち駒を合わせて、歩は 18 枚、香・桂・銀・金は 4 枚、角・飛は 2 枚までです";
    const PLY = "SFEN の最後の数字 (手数) は 1 から 1,000,000 までにしてください";
    const FIELDS =
        "SFEN は「盤面 手番 持ち駒 手数」の 4 つだけにしてください。先頭の sfen や後ろの moves は外してください";

    it.each([
        ["プリセット", "startpos", null],
        ["駒落ちのプリセット", "handicap:rook-bishop", null],
        ["入力待ち", "", null],
        ["使える局面", SFEN, null],
        ["手数を省いた局面", "4k4/9/9/9/9/9/9/9/4K4 b 2Pg", null],
        ["駒がちょうど上限まである局面", "4k4/9/9/9/9/9/9/+R8/4K4 b 9Pr9p 1000000", null],
        ["玉の無い局面", "9/9/9/9/9/9/9/9/4K4 b G 1", KINGS],
        ["先手玉が 2 枚ある局面", "4k4/9/9/9/9/9/9/9/3KK4 b - 1", KINGS],
        ["持ち駒の歩が 19 枚", "4k4/9/9/9/9/9/9/9/4K4 b 19P 1", PIECES],
        ["先手と後手の持ち駒を合わせて飛車が 3 枚", "4k4/9/9/9/9/9/9/9/4K4 b 2Rr 1", PIECES],
        ["成った飛車と持ち駒を合わせて 3 枚", "4k4/9/9/9/9/9/9/+R8/4K4 b 2R 1", PIECES],
        ["手数が 0", "4k4/9/9/9/9/9/9/9/4K4 b - 0", PLY],
        ["手数が負", "4k4/9/9/9/9/9/9/9/4K4 b - -1", PLY],
        ["手数が上限を超える", "4k4/9/9/9/9/9/9/9/4K4 b - 1000001", PLY],
        ["読めない文字列", "xyz", FORMAT],
        ["1 段が 10 マス", "4k5/9/9/9/9/9/9/9/4K4 b - 1", FORMAT],
        ["成れない金の成り", "4k4/9/9/9/9/9/9/+G8/4K4 b - 1", FORMAT],
        ["持ち駒に同じ駒を 2 度書く", "4k4/9/9/9/9/9/9/9/4K4 b PP 1", FORMAT],
        ["持ち駒の数が 0", "4k4/9/9/9/9/9/9/9/4K4 b 0P 1", FORMAT],
        ["持ち駒に玉", "4k4/9/9/9/9/9/9/9/4K4 b K 1", FORMAT],
        ["先頭に sfen が付いた局面", "sfen 4k4/9/9/9/9/9/9/9/4K4 b - 1", FIELDS],
        ["後ろに moves が付いた局面", "4k4/9/9/9/9/9/9/9/4K4 b - 1 moves 5i5h", FIELDS],
        ["選択肢の SFEN 直接入力そのもの", "custom", FORMAT],
        ["先頭に 0 の付いた手数", "4k4/9/9/9/9/9/9/9/4K4 b - 01", FORMAT],
        ["数字でない手数", "4k4/9/9/9/9/9/9/9/4K4 b - 1.5", FORMAT],
        ["安全な整数を超える持ち駒の数", "4k4/9/9/9/9/9/9/9/4K4 b 99999999999999999999P 1", PIECES],
        ["区切りの空白が複数ある手数省略の局面", "4k4/9/9/9/9/9/9/9/4K4  b   -", null],
        ["長すぎる文字列", `4k4/9/9/9/9/9/9/9/4K4 b - 1${" ".repeat(512)}`, FORMAT],
    ])("%s", (_label, value, expected) => {
        expect(onlineStartSfenProblem(value)).toBe(expected);
    });
});
