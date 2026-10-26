import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportDialog } from "./ImportDialog";

describe("ImportDialog", () => {
    it("見出しと中身を出し、×で閉じる", () => {
        const onOpenChange = vi.fn();
        render(
            <ImportDialog open onOpenChange={onOpenChange}>
                <p>中身</p>
            </ImportDialog>,
        );
        expect(screen.getByRole("dialog", { name: "棋譜/局面インポート" })).toBeTruthy();
        expect(screen.getByText("中身")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
