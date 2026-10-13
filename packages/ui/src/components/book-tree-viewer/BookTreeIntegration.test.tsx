import { applyMoveWithState, createInitialPositionState, positionToBookKey } from "@shogi/app-core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookTreeViewer } from "./BookTreeViewer";

afterEach(cleanup);
beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
});
const initial = createInitialPositionState();
function key(...moves: string[]) {
    return positionToBookKey(
        moves.reduce((state, move) => applyMoveWithState(state, move).next, initial),
    );
}
async function upload(text: string, name = "tree.db") {
    fireEvent.change(screen.getByLabelText("定跡ファイル"), {
        target: { files: [{ name, size: text.length, text: async () => text }] },
    });
    await screen.findByText(name);
    return within(await screen.findByRole("region", { name: "定跡の木" }));
}

describe("木と盤面の連動", () => {
    it.each([
        "読み直し",
        "見る側",
    ])("%sの変更後に予約済みの旧い展開が新しい木を上書きしない", async (change) => {
        let finish: (moves: string[]) => void = () => {};
        const fetch = vi.fn((sfen: string) => {
            if (sfen === `${key("7g7f")} 1`)
                return new Promise<string[]>((resolve) => {
                    finish = resolve;
                });
            return Promise.resolve(sfen === `${key("2g2f")} 1` ? ["3c3d"] : []);
        });
        render(<BookTreeViewer fetchLegalMoves={fetch} />);
        const old = await upload(`sfen ${key()}\n7g7f\n2g2f\nsfen ${key("2g2f", "3c3d")}\n6g6f`);
        await old.findByRole("button", { name: /1手目.*2六歩/ });
        for (const name of [/2六歩/, /3四歩/]) {
            const list = within(screen.getByRole("region", { name: "指し手一覧" }));
            fireEvent.click(await list.findByRole("button", { name }));
        }
        if (change === "読み直し") await upload(`sfen ${key()}\n6g6f`, "new.db");
        else fireEvent.click(screen.getByRole("button", { name: "後手の定跡として見る" }));
        const region = screen.getByRole("region", { name: "定跡の木" });
        await within(region).findByText(/組み立て完了/);
        const before = region.textContent;
        await act(async () => {
            finish([]);
            await new Promise((resolve) => setTimeout(resolve, 100));
        });
        expect(region.textContent).toBe(before);
        expect(within(region).queryByText(/組み立て中/)).toBeNull();
        if (change === "読み直し") expect(screen.getByText("new.db")).toBeTruthy();
    });
    it("合流の最初の経路が変わっても、見る側の切り替えで手順を保持する", async () => {
        const a = ["7g7f", "8c8d", "2g2f", "3c3d"];
        const b = ["2g2f", "3c3d", "7g7f", "8c8d"];
        const entries = new Map<string, string[]>();
        entries.set(key(), ["7g7f", "2g2f"]);
        for (const line of [a, b])
            for (let length = 1; length < line.length; length++)
                entries.set(key(...line.slice(0, length)), [line[length]]);
        entries.set(key(...a), ["6g6f"]);
        render(
            <BookTreeViewer
                fetchLegalMoves={async (sfen) =>
                    sfen === `${key()} 1`
                        ? ["2g2f", "7g7f"]
                        : (entries.get(sfen.replace(/ 1$/, "")) ?? [])
                }
            />,
        );
        const tree = await upload(
            [...entries]
                .map(([position, moves]) => `sfen ${position}\n${moves.join("\n")}`)
                .join("\n"),
        );
        await tree.findByText(/組み立て完了/);
        fireEvent.click(
            within(tree.getAllByRole("listitem")[1]).getByRole("button", { name: /3四歩/ }),
        );
        const nav = screen.getByRole("navigation", { name: "現在局面までの手順" });
        const before = nav.textContent;
        expect(before).toMatch(/7六歩.*8四歩.*2六歩.*3四歩/);
        fireEvent.click(screen.getByRole("button", { name: "後手の定跡として見る" }));
        await within(screen.getByRole("region", { name: "定跡の木" })).findByText(/組み立て完了/);
        expect(nav.textContent).toBe(before);
        expect(screen.getByText(key(...a))).toBeTruthy();
        expect(
            (await screen.findByRole("button", { name: /3四歩.*合流/ })).getAttribute(
                "aria-current",
            ),
        ).toBe("step");
        fireEvent.click(screen.getByRole("button", { name: "1 手戻る" }));
        expect(nav.textContent).toMatch(/7六歩.*8四歩.*2六歩/);
        fireEvent.click(screen.getByRole("button", { name: "先手の定跡として見る" }));
        const rebuilt = within(screen.getByRole("region", { name: "定跡の木" }));
        await rebuilt.findByText(/組み立て完了/);
        fireEvent.click(
            await within(screen.getByRole("region", { name: "定跡の木" })).findByRole("button", {
                name: /6六歩/,
            }),
        );
        const continuation = nav.textContent;
        fireEvent.click(screen.getByRole("button", { name: "後手の定跡として見る" }));
        await within(screen.getByRole("region", { name: "定跡の木" })).findByText(/組み立て完了/);
        expect(nav.textContent).toBe(continuation);
        expect(
            screen.getByRole("region", { name: "定跡の木" }).querySelector('[aria-current="step"]'),
        ).toBeNull();
    });

    it("木にある局面へ一覧・入力から移動したときだけページを盤面へスクロールする", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        const tree = await upload(`sfen ${key()}\n7g7f\n2g2f`);
        await tree.findByText(/組み立て完了/);
        const scroll = vi.mocked(Element.prototype.scrollIntoView);
        scroll.mockClear();
        fireEvent.click(
            within(screen.getByRole("region", { name: "指し手一覧" })).getByRole("button", {
                name: /7六歩/,
            }),
        );
        expect(scroll).not.toHaveBeenCalled();
        fireEvent.click(
            within(screen.getByRole("region", { name: "分かれ目の一覧" })).getByRole("button"),
        );
        expect(scroll).toHaveBeenCalledTimes(1);
        const board = scroll.mock.contexts[0] as Element;
        expect(board.querySelector('[aria-label="指し手一覧"]')).toBeTruthy();
        expect(board.closest('[aria-label="定跡の木"]')).toBeNull();
        fireEvent.change(screen.getByLabelText("局面キー"), { target: { value: key("7g7f") } });
        fireEvent.click(screen.getByRole("button", { name: "局面へ移動" }));
        expect(scroll).toHaveBeenCalledTimes(2);
        expect(scroll.mock.contexts[1]).toBe(board);
        await act(async () => {});
    });

    it("合法手取得に失敗すると届かない局面の確定を保留する", async () => {
        render(
            <BookTreeViewer
                fetchLegalMoves={async () => {
                    throw new Error("unavailable");
                }}
            />,
        );
        await upload(`sfen ${key()}\n7g7f\nsfen ${key("2g2f", "3c3d")}\n7g7f`);
        await screen.findByText(
            "合法手を取得できなかった局面があるため、届かない局面は確定していません",
        );
        expect(screen.queryByRole("region", { name: "平手から届かない局面" })).toBeNull();
    });
    it("構築途中の枝を操作でき、更新後も閉じた状態を保持する", async () => {
        let resolve: (moves: string[]) => void = () => {};
        render(
            <BookTreeViewer
                fetchLegalMoves={(sfen) =>
                    sfen === `${key("7g7f")} 1`
                        ? new Promise<string[]>((done) => {
                              resolve = done;
                          })
                        : Promise.resolve([])
                }
            />,
        );
        const tree = await upload(`sfen ${key()}\n7g7f\n2g2f`);
        await tree.findByRole("button", { name: /1手目.*7六歩/ });
        expect(tree.getByText(/組み立て中/)).toBeTruthy();
        fireEvent.click(tree.getByRole("button", { name: "平手初期局面 の枝を閉じる" }));
        expect(tree.getAllByRole("listitem")).toHaveLength(1);
        await act(async () => resolve([]));
        await tree.findByText(/組み立て完了/);
        expect(tree.getAllByRole("listitem")).toHaveLength(1);
    });
    it("圧縮した行の各手で局面と手順を変え、合流は最初のノードを選ぶ", async () => {
        const a = ["7g7f", "8c8d", "2g2f", "3c3d"];
        const b = ["2g2f", "3c3d", "7g7f", "8c8d"];
        const responses = new Map<string, string[]>();
        for (const line of [a, b])
            for (const length of [1, 3])
                responses.set(`${key(...line.slice(0, length))} 1`, [line[length]]);
        render(<BookTreeViewer fetchLegalMoves={async (sfen) => responses.get(sfen) ?? []} />);
        const tree = await upload(
            `sfen ${key()}\n7g7f\n2g2f\nsfen ${key(...a.slice(0, 2))}\n2g2f\nsfen ${key(...b.slice(0, 2))}\n7g7f\nsfen ${key(...a)}\n6g6f`,
        );
        await tree.findByText(/組み立て完了/);
        expect(tree.getAllByRole("listitem")).toHaveLength(3);
        const row = within(tree.getAllByRole("listitem")[1]);
        expect(row.getAllByRole("button")).toHaveLength(5);
        fireEvent.click(row.getByRole("button", { name: /8四歩/ }));
        expect(screen.getByText(key(...a.slice(0, 2)))).toBeTruthy();
        const steps = within(screen.getByRole("navigation", { name: "現在局面までの手順" }));
        expect(steps.getAllByRole("button")).toHaveLength(3);
        fireEvent.click(row.getByRole("button", { name: /2六歩/ }));
        expect(screen.getByText(key(...a.slice(0, 3)))).toBeTruthy();
        fireEvent.click(tree.getByRole("button", { name: /合流/ }));
        expect(screen.getByText(key(...a))).toBeTruthy();
        expect(steps.getAllByRole("button")[1].textContent).toContain("7六歩");
        expect(row.getByRole("button", { name: /3四歩/ }).getAttribute("aria-current")).toBe(
            "step",
        );
        expect(tree.getByRole("button", { name: /合流/ }).getAttribute("aria-current")).toBeNull();
        fireEvent.click(tree.getByRole("button", { name: "すべて閉じる" }));
        expect(tree.getAllByRole("listitem")).toHaveLength(1);
        fireEvent.change(screen.getByLabelText("局面キー"), { target: { value: key(...a) } });
        fireEvent.click(screen.getByRole("button", { name: "局面へ移動" }));
        await waitFor(() => expect(tree.getAllByRole("listitem")).toHaveLength(3));
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    });
    it("StrictMode でも構築を重複せず、見る側・ファイル変更時に古い応答を捨てる", async () => {
        let resolve: (moves: string[]) => void = () => {};
        const fetch = vi.fn((sfen: string) =>
            sfen === `${key("7g7f")} 1`
                ? new Promise<string[]>((done) => {
                      resolve = done;
                  })
                : Promise.resolve(sfen === `${key()} 1` ? ["7g7f"] : []),
        );
        render(
            <StrictMode>
                <BookTreeViewer fetchLegalMoves={fetch} />
            </StrictMode>,
        );
        const tree = await upload(
            `sfen ${key()}\n7g7f\nsfen ${key("7g7f")}\n8c8d\nsfen ${key("7g7f", "8c8d")}\n2g2f`,
        );
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        await tree.findByRole("button", { name: /1手目.*7六歩/ });
        fireEvent.click(screen.getByRole("button", { name: "後手の定跡として見る" }));
        const rebuilt = within(await screen.findByRole("region", { name: "定跡の木" }));
        await rebuilt.findByRole("button", { name: /8四歩/ });
        await rebuilt.findByText(/組み立て完了/);
        expect(rebuilt.queryByRole("button", { name: /2六歩/ })).toBeNull();
        await act(async () => resolve(["8c8d"]));
        expect(rebuilt.queryByRole("button", { name: /2六歩/ })).toBeNull();
        const replacement = await upload(`sfen ${key("2g2f")}\n3c3d`, "replacement.db");
        await replacement.findByText(/組み立て完了/);
        expect(replacement.queryByRole("button", { name: /8四歩/ })).toBeNull();
        const unreachable = within(screen.getByRole("region", { name: "平手から届かない局面" }));
        expect(unreachable.getByRole("heading").textContent).toContain("(1)");
        fireEvent.click(unreachable.getByRole("button"));
        expect(screen.getByRole("button", { name: "(手順なし)" })).toBeTruthy();
    });
});
