import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppDialogHost, alertDialog, confirmDialog } from "./AppDialogs";

describe("AppDialogs", () => {
    afterEach(cleanup);

    it("確認は、押したボタンで true / false を返す", async () => {
        render(<AppDialogHost />);
        let answer: Promise<boolean> = Promise.resolve(false);
        act(() => {
            answer = confirmDialog({ title: "離れますか", actionLabel: "離れる" });
        });
        expect(screen.getByRole("alertdialog", { name: "離れますか" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "離れる" }));
        await expect(answer).resolves.toBe(true);

        act(() => {
            answer = confirmDialog({ title: "離れますか", cancelLabel: "戻る" });
        });
        fireEvent.click(screen.getByRole("button", { name: "戻る" }));
        await expect(answer).resolves.toBe(false);
    });

    it("Esc で閉じたら false を返す", async () => {
        render(<AppDialogHost />);
        let answer: Promise<boolean> = Promise.resolve(true);
        act(() => {
            answer = confirmDialog({ title: "離れますか" });
        });
        fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
        await expect(answer).resolves.toBe(false);
    });

    it("続けて出したお知らせは、1 つずつ順に出す", async () => {
        render(<AppDialogHost />);
        let first: Promise<void> = Promise.resolve();
        let second: Promise<void> = Promise.resolve();
        act(() => {
            first = alertDialog({ title: "1 つめ" });
            second = alertDialog({ title: "2 つめ", description: "説明" });
        });
        expect(screen.queryByRole("button", { name: "やめる" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "OK" }));
        await first;
        expect(screen.getByRole("alertdialog", { name: "2 つめ" })).toBeTruthy();
        expect(screen.getByText("説明")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "OK" }));
        await second;
    });
});
