import { STUDY_HIRATE_SFEN } from "@shogi/app-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StudyImportForm, StudyStartFromHirateButton } from "./StudyImportForm";

describe("StudyImportForm", () => {
    const dropFile = (name: string, text: string): void => {
        const file = new File([text], name, { type: "text/plain" });
        const zone = screen.getByText("ファイルをここに落とす").closest("fieldset") as HTMLElement;
        fireEvent.dragEnter(zone, { dataTransfer: { files: [file] } });
        fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    };

    it("ファイルを枠に落とすと、その時点で読み込む", async () => {
        const onImport = vi.fn().mockResolvedValue(undefined);
        render(<StudyImportForm onImport={onImport} />);
        dropFile("game.csa", "V2.2\nPI\n+\n+7776FU\n-3334FU\n");
        await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
        expect(onImport.mock.calls[0][0]).toMatchObject({ kind: "csa" });
    });

    it("読み込み・保存の途中にもう一度落としても、1 回だけ取り込む", async () => {
        let finish: () => void = () => {};
        const onImport = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        );
        render(<StudyImportForm onImport={onImport} />);
        const csa = "V2.2\nPI\n+\n+7776FU\n";
        dropFile("a.csa", csa);
        dropFile("b.csa", csa);
        await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
        dropFile("c.csa", csa);
        finish();
        await waitFor(() =>
            expect(
                screen.getByRole<HTMLButtonElement>("button", { name: "ファイルを選ぶ" }).disabled,
            ).toBe(false),
        );
        expect(onImport).toHaveBeenCalledTimes(1);
    });

    it("呼び出し側で保存が進んでいる間は、落としても取り込まない", async () => {
        const onImport = vi.fn().mockResolvedValue(undefined);
        render(<StudyImportForm onImport={onImport} busy />);
        dropFile("a.csa", "V2.2\nPI\n+\n+7776FU\n");
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(onImport).not.toHaveBeenCalled();
        expect(
            screen.getByRole<HTMLButtonElement>("button", { name: "ファイルを選ぶ" }).disabled,
        ).toBe(true);
    });

    it("複数のファイルを落としたら、取り込まずに 1 つずつ落とすよう知らせる", () => {
        const onImport = vi.fn().mockResolvedValue(undefined);
        render(<StudyImportForm onImport={onImport} />);
        const zone = screen.getByText("ファイルをここに落とす").closest("fieldset") as HTMLElement;
        const files = [
            new File(["V2.2"], "a.csa", { type: "text/plain" }),
            new File(["V2.2"], "b.csa", { type: "text/plain" }),
        ];
        fireEvent.drop(zone, { dataTransfer: { files } });
        expect(screen.getByRole("alert").textContent).toBe("ファイルは 1 つずつ落としてください。");
        expect(onImport).not.toHaveBeenCalled();
    });

    it("読めないファイルを落としたら理由を出す", async () => {
        const onImport = vi.fn().mockResolvedValue(undefined);
        render(<StudyImportForm onImport={onImport} />);
        dropFile("memo.txt", "これは棋譜ではありません");
        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(onImport).not.toHaveBeenCalled();
    });

    it("受け付ける形式を枠に出し、貼り付けのボタンの文言を変えられる", () => {
        render(<StudyImportForm onImport={vi.fn()} submitLabel="ノートを作る" />);
        expect(screen.getByText(".csa .kif .kifu .sfen .txt .jsonl")).toBeTruthy();
        expect(screen.getByRole("button", { name: "ノートを作る" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "ファイルを選ぶ" })).toBeTruthy();
    });
});

describe("StudyStartFromHirateButton", () => {
    it("平手の開始局面で、指し手の無いノートを作る", async () => {
        const onImport = vi.fn().mockResolvedValue(undefined);
        render(<StudyStartFromHirateButton onImport={onImport} />);
        fireEvent.click(screen.getByRole("button", { name: "平手の盤から始める" }));
        await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
        expect(onImport).toHaveBeenCalledWith({
            kind: "moves",
            startSfen: STUDY_HIRATE_SFEN,
            moves: [],
        });
    });

    it("作っている間は、ボタンを押せない", async () => {
        let finish: () => void = () => {};
        const onImport = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        );
        render(<StudyStartFromHirateButton onImport={onImport} />);
        fireEvent.click(screen.getByRole("button", { name: "平手の盤から始める" }));
        const busy = await screen.findByRole<HTMLButtonElement>("button", { name: "作成中…" });
        expect(busy.disabled).toBe(true);
        fireEvent.click(busy);
        expect(onImport).toHaveBeenCalledTimes(1);
        finish();
        const ready = await screen.findByRole<HTMLButtonElement>("button", {
            name: "平手の盤から始める",
        });
        expect(ready.disabled).toBe(false);
    });

    it("作れなかったときは理由を出す", async () => {
        const onImport = vi.fn().mockRejectedValue(new Error("上限を超えています"));
        render(<StudyStartFromHirateButton onImport={onImport} />);
        fireEvent.click(screen.getByRole("button", { name: "平手の盤から始める" }));
        expect((await screen.findByRole("alert")).textContent).toBe("上限を超えています");
    });
});
