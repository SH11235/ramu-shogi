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

function drag(clientX: number, clientY: number): void {
    act(() => {
        document.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY }));
        document.dispatchEvent(new MouseEvent("mouseup"));
    });
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
        drag(80, 70);
        expect(windowElement().style.left).toBe("40px");
        expect(windowElement().style.top).toBe("40px");
    });

    it("閉じるボタンの上で押してから動かしても窓は動かない", () => {
        render(
            <FloatingWindow title="詳細" onClose={() => {}} {...GEOMETRY}>
                本文
            </FloatingWindow>,
        );
        fireEvent.mouseDown(screen.getByRole("button", { name: "閉じる" }), {
            clientX: 50,
            clientY: 50,
        });
        drag(80, 70);
        expect(windowElement().style.left).toBe("10px");
        expect(windowElement().style.top).toBe("20px");
    });

    it("閉じるボタンは元の文字のボタンと同じ余白・角丸・hover で、既定の class を打ち消す", () => {
        render(
            <FloatingWindow title="詳細" onClose={() => {}} {...GEOMETRY}>
                本文
            </FloatingWindow>,
        );
        const classes = screen.getByRole("button", { name: "閉じる" }).className.split(" ");
        expect(classes).toEqual(
            expect.arrayContaining([
                "px-1.5",
                "py-0.5",
                "rounded",
                "cursor-pointer",
                "hover:bg-accent",
                "text-muted-foreground",
            ]),
        );
        for (const removed of ["p-2", "rounded-lg", "hover:bg-muted", "hover:text-foreground"]) {
            expect(classes).not.toContain(removed);
        }
        expect(classes).not.toContain("transition-colors");
    });

    it("見出しの帯は既定で中身に合わせた高さ、headerClassName で固定できる", () => {
        const { rerender } = render(
            <FloatingWindow title="詳細" onClose={() => {}} {...GEOMETRY}>
                本文
            </FloatingWindow>,
        );
        const toolbar = () => screen.getByRole("toolbar", { name: "ウィンドウ移動ハンドル" });
        expect(toolbar().className).not.toMatch(/(^| )h-/);
        rerender(
            <FloatingWindow
                title="詳細"
                onClose={() => {}}
                headerClassName="box-border h-10"
                {...GEOMETRY}
            >
                本文
            </FloatingWindow>,
        );
        expect(toolbar().className).toContain("h-10");
    });

    it("右下のつまみで大きさを変えられる", () => {
        render(
            <FloatingWindow title="詳細" onClose={() => {}} {...GEOMETRY}>
                本文
            </FloatingWindow>,
        );
        const corner = windowElement().querySelector(".cursor-nwse-resize.right-0");
        if (!corner) throw new Error("つまみが見つからない");
        fireEvent.mouseDown(corner, { clientX: 300, clientY: 200 });
        drag(350, 260);
        expect(windowElement().style.width).toBe("350px");
        expect(windowElement().style.height).toBe("260px");
    });

    it("動かして大きさを変えたあと、閉じて開き直しても位置と大きさが残る", () => {
        const view = (open: boolean) => (
            <FloatingWindow title="詳細" onClose={() => {}} open={open} {...GEOMETRY}>
                本文
            </FloatingWindow>
        );
        const { rerender } = render(view(true));
        fireEvent.mouseDown(screen.getByRole("toolbar", { name: "ウィンドウ移動ハンドル" }), {
            clientX: 50,
            clientY: 50,
        });
        drag(80, 70);
        const corner = windowElement().querySelector(".cursor-nwse-resize.right-0");
        if (!corner) throw new Error("つまみが見つからない");
        fireEvent.mouseDown(corner, { clientX: 0, clientY: 0 });
        drag(50, 40);
        rerender(view(false));
        expect(screen.queryByText("本文")).toBeNull();
        rerender(view(true));
        const element = windowElement();
        expect([element.style.left, element.style.top]).toEqual(["40px", "40px"]);
        expect([element.style.width, element.style.height]).toEqual(["350px", "240px"]);
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
