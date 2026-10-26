import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabHeader } from "./TabHeader";

const TABS = [
    { id: "kifu" as const, label: "棋譜" },
    { id: "ai" as const, label: "AI解析" },
];

describe("TabHeader", () => {
    it("タブとして読み上げられ、選んでいるタブが分かる", () => {
        render(<TabHeader tabs={TABS} activeTab="kifu" onChange={vi.fn()} />);
        expect(screen.getByRole("tablist")).toBeTruthy();
        expect(screen.getByRole("tab", { name: "棋譜" }).getAttribute("aria-selected")).toBe(
            "true",
        );
        expect(screen.getByRole("tab", { name: "AI解析" }).getAttribute("aria-selected")).toBe(
            "false",
        );
    });

    it("押したタブを知らせる", () => {
        const onChange = vi.fn();
        render(<TabHeader tabs={TABS} activeTab="kifu" onChange={onChange} />);
        fireEvent.click(screen.getByRole("tab", { name: "AI解析" }));
        expect(onChange).toHaveBeenCalledWith("ai");
    });

    it("Tab キーで止まるのは選択中のタブだけで、左右・Home・End で移って選ぶ", () => {
        const tabs = [...TABS, { id: "memo" as const, label: "メモ" }];
        const onChange = vi.fn();
        const { rerender } = render(<TabHeader tabs={tabs} activeTab="kifu" onChange={onChange} />);
        expect(screen.getByRole("tab", { name: "棋譜" }).tabIndex).toBe(0);
        expect(screen.getByRole("tab", { name: "AI解析" }).tabIndex).toBe(-1);

        const documentKeyDown = vi.fn();
        document.addEventListener("keydown", documentKeyDown);
        try {
            fireEvent.keyDown(screen.getByRole("tab", { name: "棋譜" }), { key: "ArrowRight" });
            expect(onChange).toHaveBeenLastCalledWith("ai");
            expect(document.activeElement).toBe(screen.getByRole("tab", { name: "AI解析" }));
            // 棋譜の矢印キー送り（document で聞いている）には届かない
            expect(documentKeyDown).not.toHaveBeenCalled();
        } finally {
            document.removeEventListener("keydown", documentKeyDown);
        }

        rerender(<TabHeader tabs={tabs} activeTab="ai" onChange={onChange} />);
        expect(screen.getByRole("tab", { name: "AI解析" }).tabIndex).toBe(0);
        fireEvent.keyDown(screen.getByRole("tab", { name: "AI解析" }), { key: "ArrowLeft" });
        expect(onChange).toHaveBeenLastCalledWith("kifu");
        fireEvent.keyDown(screen.getByRole("tab", { name: "AI解析" }), { key: "End" });
        expect(onChange).toHaveBeenLastCalledWith("memo");
        fireEvent.keyDown(screen.getByRole("tab", { name: "AI解析" }), { key: "Home" });
        expect(onChange).toHaveBeenLastCalledWith("kifu");
    });
});
