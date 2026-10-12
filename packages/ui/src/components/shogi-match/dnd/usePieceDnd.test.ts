import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragOrigin, DragPayload } from "./types";
import { usePieceDnd } from "./usePieceDnd";

// 当たり判定は elementFromPoint を使う（jsdom に無い）。ここではドロップ先を見ないので外す。
vi.mock("./hitDetection", () => ({
    getDropTarget: () => null,
    dropTargetEquals: (a: unknown, b: unknown) => a === b,
}));

const ORIGIN: DragOrigin = { type: "board", square: "7g" };
const PAYLOAD: DragPayload = { owner: "sente", pieceType: "P", isPromoted: false };
const POINTER_ID = 1;

const pointerEvent = (type: string, clientX: number, clientY: number): PointerEvent => {
    const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
    Object.defineProperty(event, "pointerId", { value: POINTER_ID });
    return event as PointerEvent;
};

/** 盤のマスに見立てたボタン。click が届いた回数を数える。 */
const addButton = () => {
    const button = document.createElement("button");
    const piece = document.createElement("span");
    button.append(piece);
    document.body.append(button);
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    return { button, piece, onClick };
};

let now = 0;

beforeEach(() => {
    now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

function setup(options: { disabled?: boolean } = {}) {
    const hook = renderHook(() => usePieceDnd({ disabled: options.disabled }));
    const source = addButton();
    const other = addButton();

    /** 駒（ボタンの中の要素）を押して、スロップを超えるまで動かす＝ドラッグ開始 */
    const startDrag = () => {
        act(() => {
            hook.result.current.startDrag(ORIGIN, PAYLOAD, {
                pointerId: POINTER_ID,
                pointerType: "mouse",
                clientX: 0,
                clientY: 0,
                target: source.piece,
            } as unknown as PointerEvent);
            document.dispatchEvent(pointerEvent("pointermove", 40, 40));
        });
    };
    const endDrag = () => {
        act(() => {
            document.dispatchEvent(pointerEvent("pointerup", 40, 40));
        });
    };
    return { hook, source, other, startDrag, endDrag };
}

describe("usePieceDnd: ドラッグ直後の click", () => {
    it("ドラッグを終えた直後にドラッグ元へ届く click は、盤のハンドラへ届かない", () => {
        const t = setup();
        t.startDrag();
        expect(t.hook.result.current.state.isDragging).toBe(true);
        t.endDrag();
        expect(t.hook.result.current.state.isDragging).toBe(false);

        t.source.button.click();
        expect(t.source.onClick).not.toHaveBeenCalled();

        // 捨てるのは 1 回だけ。続けて押した click は届く。
        t.source.button.click();
        expect(t.source.onClick).toHaveBeenCalledTimes(1);
    });

    it("click が pointerup とは別のタスクで届いても捨てる", async () => {
        const t = setup();
        t.startDrag();
        t.endDrag();

        // タスクを 1 つまたぎ、少し時間も進める（タッチの長押しドラッグの後の click を想定）。
        await new Promise((resolve) => setTimeout(resolve, 0));
        now += 50;

        // 駒（ボタンの中の要素）に届いた click も、ドラッグ元のボタンへの click として扱う。
        t.source.piece.click();
        expect(t.source.onClick).not.toHaveBeenCalled();
    });

    it("click を伴わずに終わったドラッグの後、時間が経ってからのクリックは届く", () => {
        const t = setup();
        t.startDrag();
        t.endDrag();

        now += 1_000;
        t.source.button.click();

        expect(t.source.onClick).toHaveBeenCalledTimes(1);
    });

    it("ドラッグ直後でも、別の要素へのクリックは届く", () => {
        const t = setup();
        t.startDrag();
        t.endDrag();

        t.other.button.click();
        expect(t.other.onClick).toHaveBeenCalledTimes(1);

        // 別の要素を押した時点で「ドラッグ由来の click 待ち」は終わり。ドラッグ元も普通に押せる。
        t.source.button.click();
        expect(t.source.onClick).toHaveBeenCalledTimes(1);
    });

    it("ドラッグにならなかった押下（クリック）の click は捨てない", () => {
        const t = setup();
        act(() => {
            t.hook.result.current.startDrag(ORIGIN, PAYLOAD, {
                pointerId: POINTER_ID,
                pointerType: "mouse",
                clientX: 0,
                clientY: 0,
                target: t.source.piece,
            } as unknown as PointerEvent);
            document.dispatchEvent(pointerEvent("pointerup", 0, 0));
        });

        t.source.button.click();

        expect(t.source.onClick).toHaveBeenCalledTimes(1);
    });
});

describe("usePieceDnd: disabled", () => {
    it("無効のときは、押して動かしてもドラッグが始まらない", () => {
        const t = setup({ disabled: true });
        t.startDrag();
        expect(t.hook.result.current.state.isDragging).toBe(false);

        t.endDrag();
        t.source.button.click();
        expect(t.source.onClick).toHaveBeenCalledTimes(1);
    });
});
