import { PROGRESS_COEFFICIENTS_SIZE } from "@shogi/app-core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NnueFvScaleInputDialog } from "./NnueFvScaleInputDialog";

afterEach(cleanup);
describe("LayerStacks model settings", () => {
    it("requires an explicit progress bucket count", () => {
        render(
            <NnueFvScaleInputDialog
                editing
                fileName="model"
                initialFvScale={16}
                onConfirm={vi.fn()}
                onCancel={() => {}}
            />,
        );
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "progresskpabs" } });
        expect((screen.getByLabelText("進行度バケット数（1〜16）") as HTMLInputElement).value).toBe(
            "",
        );
        expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(
            true,
        );
    });
    it("disables mode, count, and save while coefficients are being read", async () => {
        render(
            <NnueFvScaleInputDialog
                editing
                fileName="model"
                initialFvScale={16}
                initialLayerStacks={{ bucketMode: "progresskpabs", progressBuckets: 1 }}
                onConfirm={vi.fn()}
                onCancel={() => {}}
            />,
        );
        let finish: (bytes: ArrayBuffer) => void = () => {};
        const file = {
            size: PROGRESS_COEFFICIENTS_SIZE,
            arrayBuffer: () =>
                new Promise<ArrayBuffer>((resolve) => {
                    finish = resolve;
                }),
        };
        fireEvent.change(
            screen.getByLabelText("進行度係数ファイル（f64 LE、2 バケット以上では必須）"),
            { target: { files: [file] } },
        );
        expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
        expect(
            (screen.getByLabelText("進行度バケット数（1〜16）") as HTMLInputElement).disabled,
        ).toBe(true);
        expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(
            true,
        );
        await act(async () => finish(new ArrayBuffer(PROGRESS_COEFFICIENTS_SIZE)));
        await waitFor(() =>
            expect(
                (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled,
            ).toBe(false),
        );
    });
    it("requires an explicit mode for an existing LayerStacks model", async () => {
        const onConfirm = vi.fn();
        render(
            <NnueFvScaleInputDialog
                editing
                requireLayerStacks
                fileName="model.nnue"
                initialFvScale={16}
                onConfirm={onConfirm}
                onCancel={() => {}}
            />,
        );
        const save = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "kingrank9" } });
        expect(save.disabled).toBe(false);
        fireEvent.click(save);
        await waitFor(() =>
            expect(onConfirm).toHaveBeenCalledWith(16, "model", { bucketMode: "kingrank9" }),
        );
    });
    it("blocks multi-bucket progress models without coefficients", () => {
        render(
            <NnueFvScaleInputDialog
                editing
                requireLayerStacks
                fileName="model"
                initialFvScale={16}
                initialLayerStacks={{ bucketMode: "progresskpabs", progressBuckets: 9 }}
                onConfirm={vi.fn()}
                onCancel={() => {}}
            />,
        );
        expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(
            true,
        );
        fireEvent.change(screen.getByLabelText("進行度バケット数（1〜16）"), {
            target: { value: "1" },
        });
        expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(
            false,
        );
    });
});
