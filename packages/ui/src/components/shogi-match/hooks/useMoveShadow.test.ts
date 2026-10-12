import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShogiBoardCell } from "../../shogi-board";
import { useMoveShadow } from "./useMoveShadow";

const grid: ShogiBoardCell[][] = [
    [
        { id: "7g", piece: { owner: "sente", type: "P" } },
        { id: "7f", piece: null },
        { id: "5e", piece: null },
    ],
];

type Props = Parameters<typeof useMoveShadow>[0];

const LEGAL: ReadonlySet<string> = new Set(["7g7f", "P*5e"]);

function setup(initial: Partial<Props> = {}) {
    const getLegalSet = vi.fn(async (): Promise<ReadonlySet<string> | null> => LEGAL);
    let renders = 0;
    const base: Props = {
        enabled: true,
        selection: null,
        grid,
        turn: "sente",
        positionKey: "startpos|",
        getLegalSet,
        ...initial,
    };
    const view = renderHook(
        (props: Props) => {
            renders += 1;
            return useMoveShadow(props);
        },
        { initialProps: base },
    );
    return { view, base, getLegalSet, renders: () => renders };
}

describe("useMoveShadow", () => {
    it("選んでいない間は合法手を取りに行かない", () => {
        const { view, getLegalSet } = setup();
        expect(view.result.current).toBeNull();
        expect(getLegalSet).not.toHaveBeenCalled();
    });

    it("選んだ時に合法手を 1 度だけ取り、行き先に影を出す。外したら消す", async () => {
        const { view, base, getLegalSet, renders } = setup();
        view.rerender({ ...base, selection: { kind: "hand", piece: "P" } });
        await waitFor(() => expect(view.result.current).not.toBeNull());
        expect(view.result.current?.piece).toEqual({ owner: "sente", type: "P" });
        expect([...(view.result.current?.targets ?? [])]).toEqual(["5e"]);
        expect(getLegalSet).toHaveBeenCalledTimes(1);

        // 描画は「最初」「選んだ時」「合法手が届いた時」の 3 回だけ
        expect(renders()).toBe(3);

        view.rerender({ ...base, selection: null });
        expect(view.result.current).toBeNull();
        expect(renders()).toBe(4);
        expect(getLegalSet).toHaveBeenCalledTimes(1);
    });

    it("同じ局面で選び直したら、前に届いた合法手をそのまま使い、余分な再描画をしない", async () => {
        const { view, base, renders } = setup({ selection: { kind: "hand", piece: "P" } });
        await waitFor(() => expect(view.result.current).not.toBeNull());
        const before = renders();
        view.rerender({ ...base, selection: { kind: "square", square: "7g" } });
        // 選び直した時の 1 回だけで、すぐ影が出る
        expect([...(view.result.current?.targets ?? [])]).toEqual(["7f"]);
        await act(async () => {});
        expect(renders()).toBe(before + 1);
    });

    it("局面が変わったら、前の局面の合法手では影を出さない", async () => {
        const { view, base } = setup({ selection: { kind: "hand", piece: "P" } });
        await waitFor(() => expect(view.result.current).not.toBeNull());
        const next: ReadonlySet<string> = new Set(["P*7f"]);
        view.rerender({
            ...base,
            selection: { kind: "hand", piece: "P" },
            positionKey: "startpos|7g7f",
            getLegalSet: async () => next,
        });
        expect(view.result.current).toBeNull();
        await waitFor(() => expect([...(view.result.current?.targets ?? [])]).toEqual(["7f"]));
    });

    it("無効のとき・合法手が取れないときは影を出さない", async () => {
        const disabled = setup({ enabled: false, selection: { kind: "hand", piece: "P" } });
        await act(async () => {});
        expect(disabled.view.result.current).toBeNull();
        expect(disabled.getLegalSet).not.toHaveBeenCalled();

        const failing = setup({
            selection: { kind: "hand", piece: "P" },
            getLegalSet: async () => {
                throw new Error("engine down");
            },
        });
        await act(async () => {});
        expect(failing.view.result.current).toBeNull();
    });
});
