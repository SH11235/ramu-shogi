import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isDialogRepresentable, PlayTimeDialog } from "./PlayTimeDialog";

describe("isDialogRepresentable", () => {
    it("分ちょうどの持ち時間と、秒読みか加算のどちらか一方なら書き表せる", () => {
        expect(isDialogRepresentable({ mainMs: 600_000, byoyomiMs: 30_000, incrementMs: 0 })).toBe(
            true,
        );
        expect(isDialogRepresentable({ mainMs: 300_000, byoyomiMs: 0, incrementMs: 10_000 })).toBe(
            true,
        );
        expect(isDialogRepresentable({ mainMs: 0, byoyomiMs: 3_000, incrementMs: 0 })).toBe(true);
    });

    it("秒単位の持ち時間・秒読みと加算の両方・持ち時間なしの加算は書き表せない", () => {
        expect(isDialogRepresentable({ mainMs: 90_000, byoyomiMs: 5_000, incrementMs: 0 })).toBe(
            false,
        );
        expect(
            isDialogRepresentable({ mainMs: 300_000, byoyomiMs: 5_000, incrementMs: 5_000 }),
        ).toBe(false);
        expect(isDialogRepresentable({ mainMs: 0, byoyomiMs: 0, incrementMs: 5_000 })).toBe(false);
    });
});

function renderDialog(props: { kind: "player" | "ai"; incrementMs?: number }) {
    const onApply = vi.fn();
    render(
        <PlayTimeDialog
            open
            onOpenChange={() => {}}
            kind={props.kind}
            title="時間を指定"
            mainMs={600_000}
            byoyomiMs={props.incrementMs ? 0 : 30_000}
            incrementMs={props.incrementMs ?? 0}
            onApply={onApply}
        />,
    );
    return { onApply };
}

describe("PlayTimeDialog", () => {
    it("加算の時計で開くと加算の形になり、そのまま決められる", () => {
        const { onApply } = renderDialog({ kind: "player", incrementMs: 10_000 });
        expect(
            screen.getByRole("button", { name: /1 手ごとに加算/ }).getAttribute("aria-pressed"),
        ).toBe("true");
        fireEvent.click(screen.getByRole("button", { name: "この時間にする" }));
        expect(onApply).toHaveBeenCalledWith(
            expect.objectContaining({
                label: "10分 +10秒",
                mainMs: 600_000,
                byoyomiMs: 0,
                incrementMs: 10_000,
            }),
        );
    });

    it("加算では持ち時間 0 分を決められない", () => {
        const { onApply } = renderDialog({ kind: "ai", incrementMs: 10_000 });
        fireEvent.change(screen.getByLabelText(/^持ち時間/), { target: { value: "0" } });
        expect(screen.getByRole("alert").textContent).toContain("持ち時間を 1 分以上");
        expect(
            screen.getByRole<HTMLButtonElement>("button", { name: "この時間にする" }).disabled,
        ).toBe(true);
        expect(onApply).not.toHaveBeenCalled();
    });

    it("AI は 0 分 0 秒にできず、1 手◯秒は「1手◯秒」と書く", () => {
        const { onApply } = renderDialog({ kind: "ai" });
        fireEvent.change(screen.getByLabelText(/^持ち時間/), { target: { value: "0" } });
        fireEvent.change(screen.getByLabelText(/^秒読み/), { target: { value: "0" } });
        expect(screen.getByRole("alert").textContent).toContain("1 秒以上");
        fireEvent.change(screen.getByLabelText(/^秒読み/), { target: { value: "5" } });
        fireEvent.click(screen.getByRole("button", { name: "この時間にする" }));
        expect(onApply).toHaveBeenCalledWith(
            expect.objectContaining({ label: "1手5秒", mainMs: 0, byoyomiMs: 5_000 }),
        );
    });
});
