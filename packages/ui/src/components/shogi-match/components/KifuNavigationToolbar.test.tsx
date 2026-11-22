import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

    it("項目は Tab で止まらず、Tab / Shift+Tab でメニューを閉じて分岐のボタンへ戻る", async () => {
        renderToolbar({ currentIndex: 1, onPromoteToMain: vi.fn() });
        const trigger = screen.getByTitle(/^分岐 /);
        for (const shiftKey of [false, true]) {
            openMenu();
            for (const item of [
                ...screen.getAllByRole("menuitemradio"),
                screen.getByRole("menuitem"),
            ]) {
                expect(item.tabIndex).toBe(-1);
            }
            fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab", shiftKey });
            expect(screen.queryByRole("menu")).toBeNull();
            await waitFor(() => expect(document.activeElement).toBe(trigger));
        }
    });
});

describe("KifuNavigationToolbar の 10 手の移動", () => {
    const renderWithTen = (props: { currentPly: number; size?: "default" | "large" | "bar" }) => {
        const onBackTen = vi.fn();
        const onForwardTen = vi.fn();
        render(
            <KifuNavigationToolbar
                currentPly={props.currentPly}
                totalPly={30}
                onBack={vi.fn()}
                onForward={vi.fn()}
                onToStart={vi.fn()}
                onToEnd={vi.fn()}
                onBackTen={onBackTen}
                onForwardTen={onForwardTen}
                size={props.size}
            />,
        );
        return { onBackTen, onForwardTen };
    };

    it("10 手戻る・10 手進むを押すと、それぞれを呼ぶ", () => {
        const { onBackTen, onForwardTen } = renderWithTen({ currentPly: 15 });
        fireEvent.click(screen.getByRole("button", { name: "10手戻る" }));
        fireEvent.click(screen.getByRole("button", { name: "10手進む" }));
        expect(onBackTen).toHaveBeenCalledTimes(1);
        expect(onForwardTen).toHaveBeenCalledTimes(1);
    });

    it("最初の局面では 10 手戻るを押せない", () => {
        renderWithTen({ currentPly: 0 });
        expect(
            (screen.getByRole("button", { name: "10手戻る" }) as HTMLButtonElement).disabled,
        ).toBe(true);
        expect(
            (screen.getByRole("button", { name: "10手進む" }) as HTMLButtonElement).disabled,
        ).toBe(false);
    });

    it("1 行の帯（bar）には 10 手の移動を出さない", () => {
        renderWithTen({ currentPly: 15, size: "bar" });
        expect(screen.queryByRole("button", { name: "10手戻る" })).toBeNull();
        expect(screen.queryByRole("button", { name: "10手進む" })).toBeNull();
    });
});
