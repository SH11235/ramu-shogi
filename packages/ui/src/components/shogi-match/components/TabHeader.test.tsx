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
});
