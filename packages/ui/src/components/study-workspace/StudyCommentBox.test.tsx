import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StudyCommentBox } from "./StudyCommentBox";

function renderWithPendingSave() {
    let settle: (saved: boolean) => void = () => {};
    const onChange = vi.fn(
        () =>
            new Promise<boolean>((resolve) => {
                settle = resolve;
            }),
    );
    const onDone = vi.fn();
    render(<StudyCommentBox value="" onChange={onChange} onDone={onDone} />);
    fireEvent.change(screen.getByRole("textbox", { name: "コメント" }), {
        target: { value: "ここが分岐点" },
    });
    return { onChange, onDone, settle: (saved: boolean) => settle(saved) };
}

describe("StudyCommentBox の「完了」", () => {
    it("保存の結果を待ち、保存できてから閉じる", async () => {
        const { onChange, onDone, settle } = renderWithPendingSave();
        fireEvent.click(screen.getByRole("button", { name: "完了" }));
        expect(onChange).toHaveBeenCalledWith("ここが分岐点");
        expect(onDone).not.toHaveBeenCalled();
        expect(
            (screen.getByRole("button", { name: "保存しています…" }) as HTMLButtonElement).disabled,
        ).toBe(true);

        await act(async () => settle(true));
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("保存できなかったら閉じず、保存できなかったことを出す", async () => {
        const { onDone, settle } = renderWithPendingSave();
        fireEvent.click(screen.getByRole("button", { name: "完了" }));

        await act(async () => settle(false));
        expect(onDone).not.toHaveBeenCalled();
        expect(screen.getByText("保存できませんでした")).toBeTruthy();
        expect(screen.getByRole("button", { name: "完了" })).toBeTruthy();
    });
});
