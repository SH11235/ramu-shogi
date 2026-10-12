import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BottomSheet } from "./BottomSheet";

describe("BottomSheet", () => {
    it("説明を渡すと、読み上げ用の説明としてシートに関連付ける", () => {
        render(
            <BottomSheet open onOpenChange={() => {}} title="解析の設定" description="設定の説明">
                <p>中身</p>
            </BottomSheet>,
        );

        const dialog = screen.getByRole("dialog", { name: "解析の設定" });
        const describedBy = dialog.getAttribute("aria-describedby");
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy ?? "")?.textContent).toBe("設定の説明");
    });

    it("説明を渡さなければ、これまでどおり関連付けない", () => {
        render(
            <BottomSheet open onOpenChange={() => {}} title="設定">
                <p>中身</p>
            </BottomSheet>,
        );

        expect(screen.getByRole("dialog", { name: "設定" }).hasAttribute("aria-describedby")).toBe(
            false,
        );
    });
});
