import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppDialogHost, alertDialog, confirmDialog, dismissDialog } from "./AppDialogs";

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

    it("お知らせは OK に、確認はやめるにフォーカスし、閉じたら開く前の場所へ戻す", async () => {
        render(
            <>
                <button type="button">元の場所</button>
                <AppDialogHost />
            </>,
        );
        const origin = screen.getByRole("button", { name: "元の場所" });
        origin.focus();
        let done: Promise<void> = Promise.resolve();
        act(() => {
            done = alertDialog({ title: "お知らせ" });
        });
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "OK" }));
        fireEvent.click(screen.getByRole("button", { name: "OK" }));
        await done;
        await waitFor(() => expect(document.activeElement).toBe(origin));

        let answer: Promise<boolean> = Promise.resolve(true);
        act(() => {
            answer = confirmDialog({ title: "確認" });
        });
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "やめる" }));
        fireEvent.click(screen.getByRole("button", { name: "やめる" }));
        await answer;
        await waitFor(() => expect(document.activeElement).toBe(origin));
    });

    it("同じ key の確認は 1 つにまとめ、取り下げると false を返して閉じる", async () => {
        render(<AppDialogHost />);
        let first: Promise<boolean> = Promise.resolve(true);
        let second: Promise<boolean> = Promise.resolve(true);
        act(() => {
            first = confirmDialog({ title: "確認", key: "k" });
            second = confirmDialog({ title: "確認", key: "k" });
        });
        expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
        act(() => dismissDialog("k"));
        await expect(first).resolves.toBe(false);
        await expect(second).resolves.toBe(false);
        expect(screen.queryByRole("alertdialog")).toBeNull();
    });
});
