import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KifuImportPanel } from "./KifuImportPanel";

const onImportSfen = vi.fn(async (..._args: unknown[]) => {});
const onImportKif = vi.fn(async (..._args: unknown[]) => {});

const renderPanel = (positionReady = true) =>
    render(
        <KifuImportPanel
            onImportSfen={onImportSfen}
            onImportKif={onImportKif}
            positionReady={positionReady}
        />,
    );

const HIRATE_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const CSA_TEXT = ["V2.2", "PI", "+", "+7776FU,T4", "'** 45 -3334FU", "-3334FU,T7"].join("\n");

// 「手合割：平手\n1 ７六歩(77)\n」を Shift_JIS で符号化したバイト列。
const SJIS_KIF_BYTES = new Uint8Array([
    0x8e, 0xe8, 0x8d, 0x87, 0x8a, 0x84, 0x81, 0x46, 0x95, 0xbd, 0x8e, 0xe8, 0x0a, 0x31, 0x20, 0x82,
    0x56, 0x98, 0x5a, 0x95, 0xe0, 0x28, 0x37, 0x37, 0x29, 0x0a,
]);

const selectFile = (file: File): void => {
    const input = screen.getByLabelText(/ファイルから読み込む/) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
};

describe("KifuImportPanel", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("貼り付けた CSA を自動判別し、評価値・消費時間つきで取り込む", async () => {
        renderPanel();

        fireEvent.change(screen.getByLabelText("棋譜または局面のテキスト"), {
            target: { value: CSA_TEXT },
        });
        fireEvent.click(screen.getByRole("button", { name: "読み込み" }));

        await waitFor(() => expect(onImportSfen).toHaveBeenCalledTimes(1));
        expect(onImportSfen).toHaveBeenCalledWith("startpos", ["7g7f", "3c3d"], {
            moveData: [{ elapsedMs: 4000, evalCp: 45, pv: ["3c3d"] }, { elapsedMs: 7000 }],
        });
        expect(await screen.findByRole("button", { name: "読み込み完了" })).toBeTruthy();
    });

    it("貼り付けた SFEN は従来どおり取り込む", async () => {
        renderPanel();

        fireEvent.change(screen.getByLabelText("棋譜または局面のテキスト"), {
            target: { value: "startpos moves 7g7f 3c3d" },
        });
        fireEvent.click(screen.getByRole("button", { name: "読み込み" }));

        await waitFor(() =>
            expect(onImportSfen).toHaveBeenCalledWith(HIRATE_SFEN, ["7g7f", "3c3d"]),
        );
    });

    it("壊れた CSA はエラーを表示し、取り込まない", async () => {
        renderPanel();

        fireEvent.change(screen.getByLabelText("棋譜または局面のテキスト"), {
            target: { value: "PI\n+\n+7776FU\n+7775FU" },
        });
        fireEvent.click(screen.getByRole("button", { name: "読み込み" }));

        expect(await screen.findByText(/CSA の解析に失敗しました/)).toBeTruthy();
        expect(onImportSfen).not.toHaveBeenCalled();
    });

    it("ファイル選択は .csa / .kif / .kifu / .sfen / .txt を受け付ける", () => {
        renderPanel();
        const input = screen.getByLabelText(/ファイルから読み込む/) as HTMLInputElement;
        expect(input.type).toBe("file");
        expect(input.accept).toBe(".csa,.kif,.kifu,.sfen,.txt");
    });

    it("UTF-8 の CSA ファイルを選ぶとその場で取り込む", async () => {
        renderPanel();

        selectFile(new File([CSA_TEXT], "game.csa", { type: "text/plain" }));

        await waitFor(() => expect(onImportSfen).toHaveBeenCalledTimes(1));
        expect(onImportSfen).toHaveBeenCalledWith(
            "startpos",
            ["7g7f", "3c3d"],
            expect.objectContaining({ moveData: expect.any(Array) }),
        );
    });

    it("Shift_JIS の KIF ファイルも文字コードを判別して取り込む", async () => {
        renderPanel();

        selectFile(new File([SJIS_KIF_BYTES], "game.kif"));

        await waitFor(() => expect(onImportKif).toHaveBeenCalledTimes(1));
        expect(onImportKif.mock.calls[0]?.[0]).toEqual(["7g7f"]);
        expect(onImportSfen).not.toHaveBeenCalled();
    });

    it("局面の準備ができるまでは貼り付けもファイル選択もできない", () => {
        renderPanel(false);
        expect(
            (screen.getByLabelText("棋譜または局面のテキスト") as HTMLTextAreaElement).disabled,
        ).toBe(true);
        expect((screen.getByLabelText(/ファイルから読み込む/) as HTMLInputElement).disabled).toBe(
            true,
        );
    });

    it("上限 (2MB) を超えるファイルは読まずにエラーを表示する", async () => {
        renderPanel();
        const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));

        selectFile({
            name: "huge.csa",
            size: 2 * 1024 * 1024 + 1,
            arrayBuffer,
        } as unknown as File);

        expect(await screen.findByText("ファイルが大きすぎます（上限 2MB）")).toBeTruthy();
        expect(arrayBuffer).not.toHaveBeenCalled();
        expect(onImportSfen).not.toHaveBeenCalled();
    });

    it("A → B の順に選んだとき、読むのが遅い A は捨てて B だけを取り込む", async () => {
        renderPanel();
        const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
        let resolveA: (buffer: ArrayBuffer) => void = () => {};
        const fileA = {
            name: "a.csa",
            size: 10,
            arrayBuffer: () =>
                new Promise<ArrayBuffer>((resolve) => {
                    resolveA = resolve;
                }),
        } as unknown as File;
        const fileB = {
            name: "b.csa",
            size: 10,
            arrayBuffer: async () => encode("PI\n+\n+2726FU"),
        } as unknown as File;

        selectFile(fileA);
        selectFile(fileB);
        await waitFor(() => expect(onImportSfen).toHaveBeenCalledTimes(1));
        expect(onImportSfen).toHaveBeenLastCalledWith("startpos", ["2g2f"], expect.anything());

        // 遅れて読み終わった A は盤面に反映しない。
        await act(async () => {
            resolveA(encode("PI\n+\n+7776FU"));
            await Promise.resolve();
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(onImportSfen).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/失敗/)).toBeNull();
    });

    it("先に始めた取り込みの反映が終わってから次を反映する (入り混じらない)", async () => {
        const order: string[] = [];
        let finishFirst: () => void = () => {};
        onImportSfen.mockImplementationOnce(async (...args: unknown[]) => {
            order.push(`start:${String((args[1] as string[])[0])}`);
            await new Promise<void>((resolve) => {
                finishFirst = resolve;
            });
            order.push("end:first");
        });
        onImportSfen.mockImplementationOnce(async (...args: unknown[]) => {
            order.push(`start:${String((args[1] as string[])[0])}`);
        });
        renderPanel();

        selectFile(new File(["PI\n+\n+7776FU"], "a.csa"));
        await waitFor(() => expect(order).toEqual(["start:7g7f"]));
        selectFile(new File(["PI\n+\n+2726FU"], "b.csa"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(order).toEqual(["start:7g7f"]);

        await act(async () => {
            finishFirst();
            await Promise.resolve();
        });
        await waitFor(() => expect(order).toEqual(["start:7g7f", "end:first", "start:2g2f"]));
    });
});
