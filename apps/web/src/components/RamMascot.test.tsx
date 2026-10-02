import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RamMascot } from "./RamMascot";
import { RamNotice } from "./RamNotice";

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

    it("worried では眉が描かれる", () => {
        const { container } = render(<RamMascot mood="worried" />);
        expect(container.querySelectorAll("path[d='M43 52 L56 49']").length).toBe(1);
    });
});

describe("RamNotice", () => {
    it("error は alert、loading は status として通知される", () => {
        const { rerender } = render(<RamNotice tone="error" title="失敗" />);
        expect(screen.getByRole("alert").textContent).toContain("失敗");
        rerender(<RamNotice tone="loading" title="読み込み中" />);
        expect(screen.getByRole("status").textContent).toContain("読み込み中");
    });
});
