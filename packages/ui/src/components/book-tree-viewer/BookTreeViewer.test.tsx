import {
    applyMoveWithState,
    createInitialPositionState,
    parseStudySfen,
    positionToBookKey,
} from "@shogi/app-core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookTreeViewer, MAX_BOOK_FILE_BYTES } from "./BookTreeViewer";

afterEach(cleanup);
beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
});
const initial = createInitialPositionState();
const first = applyMoveWithState(initial, "7g7f").next;
const second = applyMoveWithState(first, "8c8d").next;
const key = positionToBookKey(initial);
async function upload(text: string, name = "sample.db") {
    fireEvent.change(screen.getByLabelText("定跡ファイル"), {
        target: { files: [{ name, size: text.length, text: async () => text }] },
    });
    await screen.findByText(name);
}
describe("BookTreeViewer", () => {
    it("駒の動きとして違法な定跡の手では局面も手順も進めない", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key}\n7g7e\n7g7f`);
        const list = within(screen.getByRole("region", { name: "指し手一覧" }));
        fireEvent.click(list.getByRole("button", { name: /7五歩/ }));
        expect(screen.getByRole("alert").textContent).toBe("この局面では指せない手です");
        expect(screen.getByText(key)).toBeTruthy();
        expect(within(screen.getByRole("navigation")).getAllByRole("button")).toHaveLength(1);
        fireEvent.click(list.getByRole("button", { name: /7六歩/ }));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByText(positionToBookKey(first))).toBeTruthy();
    });
    it("合流を越えても木を選択し、手の一覧で辿った手順を保つ", async () => {
        const lines = [
            ["7g7f", "8c8d", "2g2f", "3c3d", "6g6f"],
            ["2g2f", "3c3d", "7g7f", "8c8d", "6g6f"],
        ];
        const entries = new Map<string, Set<string>>();
        for (const moves of lines) {
            let position = initial;
            for (const move of moves) {
                const key = positionToBookKey(position);
                const choices = entries.get(key) ?? new Set<string>();
                choices.add(move);
                entries.set(key, choices);
                position = applyMoveWithState(position, move).next;
            }
        }
        render(
            <BookTreeViewer
                fetchLegalMoves={async (sfen) => [...(entries.get(sfen.replace(/ 1$/, "")) ?? [])]}
            />,
        );
        await upload(
            [...entries].map(([key, moves]) => `sfen ${key}\n${[...moves].join("\n")}`).join("\n"),
        );
        await screen.findByText(/組み立て完了/);
        for (const label of [/2六歩/, /3四歩/, /7六歩/, /8四歩/, /6六歩/]) {
            const list = within(screen.getByRole("region", { name: "指し手一覧" }));
            const button = await list.findByRole("button", { name: label });
            await act(async () => fireEvent.click(button));
        }
        const tree = screen.getByRole("region", { name: "定跡の木" });
        expect(tree.querySelector('[aria-current="step"]')?.textContent).toContain("6六歩");
        const steps = within(
            screen.getByRole("navigation", { name: "現在局面までの手順" }),
        ).getAllByRole("button");
        expect(steps.map((step) => step.textContent)).toEqual([
            "初期局面",
            "1. ☗2六歩(27)",
            "2. ☖3四歩(33)",
            "3. ☗7六歩(77)",
            "4. ☖8四歩(83)",
            "5. ☗6六歩(67)",
        ]);
        fireEvent.click(within(tree).getByRole("button", { name: "すべて閉じる" }));
        fireEvent.click(within(tree).getByRole("button", { name: "選択局面まで開く" }));
        expect(tree.querySelector('[aria-current="step"]')?.textContent).toContain("6六歩");
    });
    it("単独表示の局面が後から木に現れるとそのノードを選択する", async () => {
        let finish: (moves: string[]) => void = () => {};
        const fetch = vi.fn(
            () =>
                new Promise<string[]>((resolve) => {
                    finish = resolve;
                }),
        );
        render(<BookTreeViewer fetchLegalMoves={fetch} />);
        await upload(`sfen ${key}\n7g7f\nsfen ${positionToBookKey(second)}\n2g2f`);
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        fireEvent.change(screen.getByLabelText("局面キー"), {
            target: { value: positionToBookKey(second) },
        });
        fireEvent.click(screen.getByRole("button", { name: "局面へ移動" }));
        expect(screen.getByRole("navigation").textContent).toBe("(手順なし)");
        const tree = screen.getByRole("region", { name: "定跡の木" });
        expect(tree.querySelector('[aria-current="step"]')).toBeNull();
        await act(async () => finish(["8c8d"]));
        await waitFor(() =>
            expect(tree.querySelector('[aria-current="step"]')?.textContent).toContain("8四歩"),
        );
        expect(screen.getByRole("navigation").textContent).toContain("初期局面");
        expect(screen.getByText(positionToBookKey(second))).toBeTruthy();
    });
    it("上限超過ファイルは進行中の読み込みを中止しない", async () => {
        let finish: (text: string) => void = () => {};
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        fireEvent.change(screen.getByLabelText("定跡ファイル"), {
            target: {
                files: [
                    {
                        name: "pending.db",
                        size: 1,
                        text: () =>
                            new Promise<string>((resolve) => {
                                finish = resolve;
                            }),
                    },
                ],
            },
        });
        const text = vi.fn();
        fireEvent.change(screen.getByLabelText("定跡ファイル"), {
            target: { files: [{ name: "large.db", size: MAX_BOOK_FILE_BYTES + 1, text }] },
        });
        expect(screen.getByText("読み込み中…")).toBeTruthy();
        expect(screen.getByRole("alert").textContent).toContain("上限 64 MB");
        expect(text).not.toHaveBeenCalled();
        await act(async () => finish(`sfen ${key}\n7g7f`));
        await screen.findByText("pending.db");
        expect(screen.queryByText("読み込み中…")).toBeNull();
    });
    it("パース前のタイマー待ちで読み込み中を表示する", async () => {
        vi.stubGlobal("MessageChannel", undefined);
        vi.useFakeTimers();
        try {
            render(<BookTreeViewer fetchLegalMoves={async () => []} />);
            await act(async () => {
                fireEvent.change(screen.getByLabelText("定跡ファイル"), {
                    target: {
                        files: [
                            { name: "timer.db", size: 1, text: async () => `sfen ${key}\n7g7f` },
                        ],
                    },
                });
            });
            expect(screen.getByText("読み込み中…")).toBeTruthy();
            expect(screen.queryByRole("region", { name: "指し手一覧" })).toBeNull();
            await act(async () => {
                await vi.runAllTimersAsync();
            });
            expect(screen.getByText("timer.db")).toBeTruthy();
            expect(screen.queryByText("読み込み中…")).toBeNull();
        } finally {
            vi.useRealTimers();
            vi.unstubAllGlobals();
        }
    });
    it("見る側の定跡がないと表示し、相手側の参考の手からも進める", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${positionToBookKey(first)}\n8c8d`);
        expect(screen.getByText("この局面は定跡にありません")).toBeTruthy();
        fireEvent.change(screen.getByLabelText("局面キー"), {
            target: { value: positionToBookKey(first) },
        });
        fireEvent.click(screen.getByRole("button", { name: "局面へ移動" }));
        await screen.findByText("この先は定跡にありません");
        fireEvent.click(
            within(screen.getByRole("region", { name: "相手側の定跡" })).getByRole("button", {
                name: /8四歩/,
            }),
        );
        expect(screen.getByText(positionToBookKey(second))).toBeTruthy();
    });
    it("見る側で接続手・定跡の手・分かれ目を切り替え、局面と手順は保持する", async () => {
        const other = applyMoveWithState(first, "3c3d").next;
        const fetch = vi.fn().mockResolvedValue(["8c8d", "3c3d", "4c4d"]);
        render(<BookTreeViewer fetchLegalMoves={fetch} />);
        await upload(`sfen ${key}
7g7f
2g2f
sfen ${positionToBookKey(first)}
8c8d none -20 5 8
4c4d
sfen ${positionToBookKey(second)}
2g2f
sfen ${positionToBookKey(other)}
2g2f`);
        const list = within(screen.getByRole("region", { name: "指し手一覧" }));
        const branches = within(screen.getByRole("region", { name: "分かれ目の一覧" }));
        expect(branches.getByRole("heading").textContent).toBe("分かれ目の一覧（1 局面）");
        expect(branches.getByRole("button").textContent).toContain("先手:");
        fireEvent.click(list.getByRole("button", { name: /7六歩/ }));
        await list.findByRole("button", { name: /3四歩/ });
        expect(list.getByRole("button", { name: /8四歩/ }).textContent).toContain("定跡の手");
        const reference = within(screen.getByRole("region", { name: "相手側の定跡" }));
        expect(reference.getByText(/相手側（後手）/)).toBeTruthy();
        expect(reference.getByRole("button", { name: /4四歩/ })).toBeTruthy();
        expect(reference.queryByRole("button", { name: /8四歩/ })).toBeNull();
        await act(async () =>
            fireEvent.click(screen.getByRole("button", { name: "後手の定跡として見る" })),
        );
        expect(list.getByRole("heading", { name: "定跡の手" })).toBeTruthy();
        expect(list.getByText("-20")).toBeTruthy();
        expect(list.queryByRole("button", { name: /3四歩/ })).toBeNull();
        expect(screen.getByText(positionToBookKey(first), { selector: "p" })).toBeTruthy();
        expect(
            within(screen.getByRole("navigation", { name: "現在局面までの手順" })).getAllByRole(
                "button",
            ),
        ).toHaveLength(2);
        expect(branches.getByRole("button").textContent).toContain("後手:");
        expect(branches.getByRole("heading").textContent).toBe("分かれ目の一覧（1 局面）");
        await act(async () => fireEvent.click(list.getByRole("button", { name: /4四歩/ })));
        expect(
            screen.getByText(positionToBookKey(applyMoveWithState(first, "4c4d").next)),
        ).toBeTruthy();
    });

    it("分かれ目の表示件数を制限する", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        const board = key.split(" ")[0];
        await upload(
            Array.from(
                { length: 51 },
                (_, index) => `sfen ${board} b ${index + 1}P\n7g7f\n2g2f`,
            ).join("\n"),
        );
        const branches = within(screen.getByRole("region", { name: "分かれ目の一覧" }));
        expect(branches.getAllByRole("button")).toHaveLength(51);
        fireEvent.click(branches.getByRole("button", { name: "さらに表示" }));
        expect(branches.getAllByRole("button")).toHaveLength(51);
        expect(branches.queryByRole("button", { name: "さらに表示" })).toBeNull();
    });

    it("合法手の取得失敗を表示する", async () => {
        render(
            <BookTreeViewer
                fetchLegalMoves={async () => {
                    throw new Error("unavailable");
                }}
            />,
        );
        await upload(`sfen ${key}\n7g7f`);
        fireEvent.click(
            within(screen.getByRole("region", { name: "指し手一覧" })).getByRole("button", {
                name: /7六歩/,
            }),
        );
        expect((await screen.findByRole("alert")).textContent).toBe("合法手を取得できませんでした");
    });

    it("定跡の手を優先し、接続手を探して進み、手順を戻れる", async () => {
        const fetch = vi.fn().mockResolvedValue(["8c8d", "3c3d"]);
        render(<BookTreeViewer fetchLegalMoves={fetch} />);
        await upload(`sfen ${key}\n7g7f none 10 2 3\nsfen ${positionToBookKey(second)}\n2g2f`);

        fireEvent.click(
            within(screen.getByRole("region", { name: "指し手一覧" })).getByRole("button", {
                name: /7六歩/,
            }),
        );
        await within(screen.getByRole("region", { name: "指し手一覧" })).findByRole("button", {
            name: /8四歩/,
        });
        expect(screen.queryByRole("button", { name: /3四歩/ })).toBeNull();
        fireEvent.click(
            within(screen.getByRole("region", { name: "指し手一覧" })).getByRole("button", {
                name: /8四歩/,
            }),
        );
        expect(screen.getByRole("heading", { name: "定跡の手" })).toBeTruthy();
        expect(
            fetch.mock.calls.filter(([sfen]) => sfen === `${positionToBookKey(first)} 1`),
        ).toHaveLength(1);
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "1 手戻る" })));
        expect(screen.getByRole("heading", { name: "定跡につながる手" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "初期局面" }));
        expect(screen.getByRole("button", { name: "1 手戻る" }).hasAttribute("disabled")).toBe(
            true,
        );
    });
    it("木にある分かれ目を選び、反転、局面入力、読み直しができる", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key}\n7g7f\n2g2f`);
        await screen.findByRole("region", { name: "定跡の木" });
        fireEvent.click(
            within(screen.getByRole("region", { name: "分かれ目の一覧" })).getByRole("button"),
        );
        expect(screen.queryByText("(手順なし)")).toBeNull();
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
        fireEvent.click(screen.getByRole("button", { name: "盤を反転" }));
        expect(screen.getByRole("button", { name: "盤を反転" }).getAttribute("aria-pressed")).toBe(
            "true",
        );
        fireEvent.change(screen.getByLabelText("局面キー"), {
            target: { value: `sfen ${positionToBookKey(first)} 12` },
        });
        fireEvent.click(screen.getByRole("button", { name: "局面へ移動" }));
        await screen.findByText("この先は定跡にありません");
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
        await upload(`sfen ${key}\n2g2f`, "next.db");
        expect(screen.queryByText("(手順なし)")).toBeNull();
        expect(screen.getByRole("button", { name: "初期局面" })).toBeTruthy();
    });
    it("定跡にない A から B へ移動し、B の後に解決した A の合法手を捨てる", async () => {
        const b = applyMoveWithState(initial, "2g2f").next;
        const bNext = applyMoveWithState(b, "3c3d").next;
        const pending = new Map<string, (moves: string[]) => void>();
        const fetch = vi.fn(
            (sfen: string) => new Promise<string[]>((resolve) => pending.set(sfen, resolve)),
        );
        render(<BookTreeViewer fetchLegalMoves={fetch} />);
        await upload(`sfen ${positionToBookKey(second)}
2g2f
sfen ${positionToBookKey(bNext)}
7g7f`);
        function jumpTo(sfen: string) {
            fireEvent.change(screen.getByLabelText("局面キー"), { target: { value: sfen } });
            fireEvent.click(screen.getByRole("button", { name: "局面へ移動" }));
        }
        jumpTo(positionToBookKey(first));
        await waitFor(() => expect(pending.has(`${positionToBookKey(first)} 1`)).toBe(true));
        jumpTo(positionToBookKey(b));
        await waitFor(() => expect(pending.has(`${positionToBookKey(b)} 1`)).toBe(true));
        await act(async () => pending.get(`${positionToBookKey(b)} 1`)?.(["3c3d"]));
        expect(screen.getByRole("button", { name: /3四歩/ })).toBeTruthy();
        await act(async () => pending.get(`${positionToBookKey(first)} 1`)?.(["8c8d"]));
        expect(screen.getByRole("button", { name: /3四歩/ })).toBeTruthy();
        expect(screen.queryByText("合法手を読み込み中…")).toBeNull();
        expect(screen.queryByRole("button", { name: /8四歩/ })).toBeNull();
    });
    it.each([
        ["4k4/9/4P4/9/9/9/9/9/4K4 b -", "5c5b+", /5二歩成/],
        ["4k4/9/9/9/9/9/9/9/4K4 b P", "P*5e", /5五歩打/],
    ] as const)("成り・打ちを UI から進める: %s", async (sfen, move, label) => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${sfen}
${move}`);
        fireEvent.change(screen.getByLabelText("局面キー"), { target: { value: sfen } });
        fireEvent.click(screen.getByRole("button", { name: "局面へ移動" }));
        await act(async () =>
            fireEvent.click(
                within(screen.getByRole("region", { name: "指し手一覧" })).getByRole("button", {
                    name: label,
                }),
            ),
        );
        expect(
            screen.getByText(
                positionToBookKey(applyMoveWithState(parseStudySfen(sfen), move).next),
            ),
        ).toBeTruthy();
    });
    it("指せない定跡の手では局面を変えず、戻る操作でエラーを消す", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key}
7g7f
sfen ${positionToBookKey(first)}
5e5d`);
        fireEvent.click(
            within(screen.getByRole("region", { name: "指し手一覧" })).getByRole("button", {
                name: /7六歩/,
            }),
        );
        fireEvent.click(screen.getByRole("button", { name: "後手の定跡として見る" }));
        const list = within(screen.getByRole("region", { name: "指し手一覧" }));
        fireEvent.click(list.getByRole("button"));
        expect(screen.getByRole("alert").textContent).toBe("この局面では指せない手です");
        expect(screen.getByText(positionToBookKey(first))).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /1\. / }));
        expect(screen.queryByRole("alert")).toBeNull();
        fireEvent.click(list.getByRole("button"));
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "1 手戻る" })));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByText(key)).toBeTruthy();
    });
    it("上限超過を読み込まず、警告を表示する", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        const text = vi.fn();
        fireEvent.change(screen.getByLabelText("定跡ファイル"), {
            target: { files: [{ name: "large.db", size: MAX_BOOK_FILE_BYTES + 1, text }] },
        });
        expect(screen.getByRole("alert").textContent).toContain("上限 64 MB");
        expect(text).not.toHaveBeenCalled();
        await upload(`bad\nsfen ${key}\n2g2f`);
        await waitFor(() => expect(screen.getByText(/1 行目:/)).toBeTruthy());
    });
});
