import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloatingWindow } from "./floating-window";

const GEOMETRY = {
    initialPosition: { x: 10, y: 20 },
    initialSize: { width: 300, height: 200 },
    minWidth: 100,
    minHeight: 100,
};

function windowElement(): HTMLElement {
    const handle = screen.getByRole("toolbar", { name: "ウィンドウ移動ハンドル" });
    const element = handle.parentElement;
    if (!element) throw new Error("ウィンドウが見つからない");
    return element;
}

describe("FloatingWindow", () => {
    it("見出し・閉じるボタン・中身を描き、小窓の影と重なり順を付ける", () => {
        render(
            <FloatingWindow title="評価値推移" onClose={() => {}} {...GEOMETRY}>
                本文
            </FloatingWindow>,
        );
        expect(screen.getByText("評価値推移")).toBeTruthy();
        expect(screen.getByText("本文")).toBeTruthy();
        const element = windowElement();
        expect(element.className).toContain("shadow-panel");
        expect(element.className).toContain("z-window");
        expect(element.className).toContain("rounded-xl");
        expect(element.style.left).toBe("10px");
        expect(element.style.width).toBe("300px");
    });

    it("閉じるボタンと Esc で onClose を呼ぶ", () => {
        const onClose = vi.fn();
        render(
            <FloatingWindow title="詳細" onClose={onClose} {...GEOMETRY}>
                本文
            </FloatingWindow>,
        );
        fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("見出しの帯をつかんで動かせる", () => {
        render(
            <FloatingWindow title="詳細" onClose={() => {}} {...GEOMETRY}>
                本文
            </FloatingWindow>,
        );
        const handle = screen.getByRole("toolbar", { name: "ウィンドウ移動ハンドル" });
        fireEvent.mouseDown(handle, { clientX: 50, clientY: 50 });
        act(() => {
            document.dispatchEvent(new MouseEvent("mousemove", { clientX: 80, clientY: 70 }));
            document.dispatchEvent(new MouseEvent("mouseup"));
        });
        expect(windowElement().style.left).toBe("40px");
        expect(windowElement().style.top).toBe("40px");
    });

    it("open=false の間は描かず、Esc にも反応しない", () => {
        const onClose = vi.fn();
        render(
            <FloatingWindow title="詳細" onClose={onClose} open={false} {...GEOMETRY}>
                本文
            </FloatingWindow>,
        );
        expect(screen.queryByText("本文")).toBeNull();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).not.toHaveBeenCalled();
    });

    it("中身を関数で渡すと窓の大きさを受け取れる", () => {
        render(
            <FloatingWindow title="詳細" onClose={() => {}} {...GEOMETRY}>
                {(size) => `${size.width}x${size.height}`}
            </FloatingWindow>,
        );
        expect(screen.getByText("300x200")).toBeTruthy();
    });
});
