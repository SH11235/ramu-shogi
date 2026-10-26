import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { handleMenuKeyDown } from "./menuKeyNavigation";

const renderMenu = () =>
    render(
        <div
            role="menu"
            tabIndex={-1}
            onKeyDown={(event) =>
                handleMenuKeyDown(event, { itemSelector: "[role=menuitem]", onClose: vi.fn() })
            }
        >
            {["一", "二", "三"].map((label) => (
                <button key={label} type="button" role="menuitem" tabIndex={-1}>
                    {label}
                </button>
            ))}
        </div>,
    );

describe("handleMenuKeyDown", () => {
    it("項目の外にフォーカスがあるとき、上キーで最後の項目へ移る", () => {
        renderMenu();
        const menu = screen.getByRole("menu");
        menu.focus();
        fireEvent.keyDown(menu, { key: "ArrowUp" });
        expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "三" }));
    });

    it("項目の外にフォーカスがあるとき、下キーで最初の項目へ移る", () => {
        renderMenu();
        const menu = screen.getByRole("menu");
        menu.focus();
        fireEvent.keyDown(menu, { key: "ArrowDown" });
        expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "一" }));
    });
});
