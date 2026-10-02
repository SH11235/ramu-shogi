import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RamMascot } from "./RamMascot";

describe("RamMascot", () => {
    it("alt テキスト付きの画像として公開される", () => {
        render(<RamMascot />);
        expect(screen.getByRole("img", { name: "トイプードルのラム" })).toBeTruthy();
    });

    it("thinking / animated を data 属性に反映する", () => {
        const { container } = render(<RamMascot thinking animated={false} />);
        const svg = container.querySelector("svg");
        expect(svg?.hasAttribute("data-thinking")).toBe(true);
        expect(svg?.hasAttribute("data-animated")).toBe(false);
    });

    it("decorative では支援技術から隠し、複数描画でも gradient id が重複しない", () => {
        const { container } = render(
            <>
                <RamMascot decorative />
                <RamMascot decorative />
            </>,
        );
        expect(container.querySelectorAll("[role='img']").length).toBe(0);
        const ids = [...container.querySelectorAll("radialGradient")].map((g) => g.id);
        expect(new Set(ids).size).toBe(2);
    });

    it("worried では眉が描かれる", () => {
        const { container } = render(<RamMascot mood="worried" />);
        expect(container.querySelectorAll("path[d='M43 52 L56 49']").length).toBe(1);
    });
});
