import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KifuNavigationToolbar } from "./KifuNavigationToolbar";

function renderToolbar(branch: { currentIndex?: number; onPromoteToMain?: () => void } = {}) {
    const onSwitch = vi.fn();
    render(
        <KifuNavigationToolbar
            currentPly={3}
            totalPly={5}
            onBack={vi.fn()}
            onForward={vi.fn()}
            onToStart={vi.fn()}
            onToEnd={vi.fn()}
            branchInfo={{
                hasBranches: true,
                currentIndex: branch.currentIndex ?? 0,
                count: 3,
                onSwitch,
                onPromoteToMain: branch.onPromoteToMain,
            }}
        />,
    );
    return { onSwitch };
}

const openMenu = () => fireEvent.click(screen.getByTitle(/^分岐 /));

describe("KifuNavigationToolbar の分岐メニュー", () => {
    it("開くと今の分岐にフォーカスし、選ぶと切り替えて閉じる", () => {
        const { onSwitch } = renderToolbar({ currentIndex: 1 });
        openMenu();
        const current = screen.getByRole("menuitemradio", { name: "変化 2" });
        expect(current.getAttribute("aria-checked")).toBe("true");
        expect(document.activeElement).toBe(current);

        fireEvent.click(screen.getByRole("menuitemradio", { name: "変化 3" }));
        expect(onSwitch).toHaveBeenCalledWith(2);
        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("上下キーで項目を移り、Esc で閉じる", () => {
        renderToolbar({ currentIndex: 0 });
        openMenu();
        const menu = screen.getByRole("menu", { name: "分岐選択" });
        fireEvent.keyDown(menu, { key: "ArrowDown" });
        expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "変化 2" }));
        fireEvent.keyDown(menu, { key: "ArrowUp" });
        fireEvent.keyDown(menu, { key: "ArrowUp" });
        expect(document.activeElement).toBe(screen.getByRole("menuitemradio", { name: "変化 3" }));
        fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("メイン以外を選んでいるときは、メインに昇格できる", () => {
        const onPromoteToMain = vi.fn();
        renderToolbar({ currentIndex: 2, onPromoteToMain });
        openMenu();
        fireEvent.click(screen.getByRole("menuitem", { name: "★ メインに昇格" }));
        expect(onPromoteToMain).toHaveBeenCalled();
        expect(screen.queryByRole("menu")).toBeNull();
    });
});
