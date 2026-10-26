import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChoiceGroup } from "./choice-group";

const OPTIONS = [
    { value: 1, label: "1秒" },
    { value: 2, label: "2秒" },
    { value: 3, label: "3秒", ariaLabel: "3 秒" },
] as const;

describe("ChoiceGroup", () => {
    it("選んでいる項目だけが aria-pressed=true になる", () => {
        render(<ChoiceGroup options={OPTIONS} value={2} onChange={() => {}} />);
        expect(screen.getByRole("button", { name: "1秒" }).getAttribute("aria-pressed")).toBe(
            "false",
        );
        expect(screen.getByRole("button", { name: "2秒" }).getAttribute("aria-pressed")).toBe(
            "true",
        );
    });

    it("押した項目の値を渡し、ariaLabel があれば読み上げ名に使う", () => {
        const onChange = vi.fn();
        render(<ChoiceGroup options={OPTIONS} value={null} onChange={onChange} />);
        fireEvent.click(screen.getByRole("button", { name: "3 秒" }));
        expect(onChange).toHaveBeenCalledWith(3);
        for (const button of screen.getAllByRole("button")) {
            expect(button.getAttribute("aria-pressed")).toBe("false");
        }
    });

    it("選んでいる項目は墨で示し、朱・藍を使わない", () => {
        render(<ChoiceGroup options={OPTIONS} value={1} onChange={() => {}} />);
        const selected = screen.getByRole("button", { name: "1秒" });
        expect(selected.className).toContain("border-wafuu-sumi");
        expect(selected.className).not.toMatch(/wafuu-(shu|ai)/);
        expect(selected.className).toContain("font-semibold");
        expect(selected.className).not.toContain("font-medium");
    });
});
