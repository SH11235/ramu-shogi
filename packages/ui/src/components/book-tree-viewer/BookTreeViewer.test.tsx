import { applyMoveWithState, createInitialPositionState, positionToBookKey } from "@shogi/app-core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookTreeViewer, MAX_BOOK_FILE_BYTES } from "./BookTreeViewer";
import { loadLastBookFile } from "./lastBookFile";

vi.mock("./lastBookFile", () => ({
    loadLastBookFile: vi.fn(async () => null),
    saveLastBookFile: vi.fn(async () => {}),
}));

const initial = createInitialPositionState();
function key(...moves: string[]) {
    return positionToBookKey(
        moves.reduce((state, move) => applyMoveWithState(state, move).next, initial),
    );
}
/** 測った幅を PC の幅にする（盤・指し手の一覧と木を横に並べる配置で試す）。 */
function wideObserver(callback: ResizeObserverCallback) {
    const observer = {
        observe(target: Element) {
            callback(
                [{ target, contentRect: { width: 1200, height: 800 } } as ResizeObserverEntry],
                observer as unknown as ResizeObserver,
            );
        },
        disconnect() {},
        unobserve() {},
    };
    return observer;
}
/** `new ResizeObserver(...)` で呼ばれるので、アロー関数ではなく関数宣言にする。 */
function WideResizeObserver(callback: ResizeObserverCallback) {
    return wideObserver(callback);
}
beforeEach(() => {
    vi.stubGlobal("ResizeObserver", WideResizeObserver);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

async function upload(text: string, name = "sample.db") {
    fireEvent.change(screen.getByLabelText("定跡ファイル"), {
        target: { files: [{ name, size: text.length, text: async () => text }] },
    });
    await screen.findByText(name);
}
const moves = () => within(screen.getByRole("region", { name: "この局面の指し手" }));
const tree = () => within(screen.getByRole("region", { name: "定跡の木" }));
const current = () =>
    screen.getAllByRole("status").find((element) => /手目|開始局面/.test(element.textContent ?? ""))
        ?.textContent;
const built = () => screen.findByText(/局面を展開$/);

describe("BookTreeViewer", () => {
    it("StrictMode でも、最後に開いた定跡を開き直す", async () => {
        const text = `sfen ${key()}
7g7f`;
        // StrictMode ではエフェクトが 2 回走り、1 回目の結果は捨てられるので、どの呼び出しにも返す。
        vi.mocked(loadLastBookFile).mockResolvedValue(
            new File([text], "last.db", { type: "text/plain" }),
        );
        render(
            <StrictMode>
                <BookTreeViewer fetchLegalMoves={async () => []} />
            </StrictMode>,
        );
        expect(await screen.findByText("last.db")).toBeTruthy();
        vi.mocked(loadLastBookFile).mockResolvedValue(null);
    });
    it("指し手の一覧と木のどちらから選んでも、盤の局面と木の選択がそろう", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(
            `sfen ${key()}\n7g7f 8c8d 100 12 3\nsfen ${key("7g7f")}\n8c8d\nsfen ${key("7g7f", "8c8d")}\n2g2f`,
        );
        await built();
        const row = moves().getByRole("button", { name: /7六歩/ }).closest("tr");
        expect(row?.textContent).toContain("100");
        expect(row?.textContent).toContain("12");
        fireEvent.click(moves().getByRole("button", { name: /7六歩/ }));
        expect(current()).toBe("1手目 ☗7六歩(77)");
        fireEvent.click(tree().getByRole("button", { name: /^☖8四歩\(83\)/ }));
        expect(current()).toBe("2手目 ☖8四歩(83)");
        expect(moves().getByRole("button", { name: /2六歩/ })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "開始局面へ" }));
        expect(current()).toBe("開始局面");
    });
    it("評価値は手番によらず先手から見た値で出す", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(
            `sfen ${key()}\n7g7f none 40 12 3\nsfen ${key("7g7f")}\n8c8d none 30 12 3\n3c3d none -20 12 3`,
        );
        await built();
        await waitFor(() => expect(current()).toBe("1手目 ☗7六歩(77)"));
        const value = (name: RegExp) =>
            moves().getByRole("button", { name }).closest("tr")?.children[1].textContent;
        expect(value(/8四歩/)).toBe("-30");
        expect(value(/3四歩/)).toBe("20");
        const node = tree().getByRole("button", { name: /^☖8四歩\(83\)/ });
        expect(node.getAttribute("aria-label")).toContain("評価値 -30");
    });
    it("開始局面から一本道が続く定跡は、最初に分かれる手を選んだ状態で開く", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()}
7g7f
sfen ${key("7g7f")}
8c8d
sfen ${key("7g7f", "8c8d")}
2g2f
6g6f`);
        await built();
        await waitFor(() => expect(current()).toBe("2手目 ☖8四歩(83)"));
        const trail = within(screen.getByRole("navigation", { name: "選んだ手までの道筋" }));
        expect(trail.getAllByRole("button").map((button) => button.textContent)).toEqual([
            "開始",
            "2 ☖8四歩(83)",
        ]);
        fireEvent.click(trail.getByRole("button", { name: "開始" }));
        expect(current()).toBe("開始局面");
    });
    it("平手から定跡に入れない定跡は、定跡の中の局面から始め、候補を選び直せる", async () => {
        const mid = ["7g7f", "3c3d", "8h2b+", "3a2b"];
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(
            `sfen ${key(...mid)} 5
B*4e
sfen ${key("2g2f", "8c8d")} 3
2f2e
2f2e`,
        );
        await built();
        const root = await screen.findByRole("combobox", { name: "開始局面" });
        expect(
            within(root)
                .getAllByRole("option")
                .map((option) => option.textContent),
        ).toEqual(["候補 1（3手目の局面）", "候補 2（5手目の局面）"]);
        expect(tree().getByRole("button", { name: /^☗2五歩\(26\)/ })).toBeTruthy();
        fireEvent.change(root, { target: { value: key(...mid) } });
        await built();
        expect(await tree().findByRole("button", { name: /^☗4五角打/ })).toBeTruthy();
        expect(screen.getByRole("combobox", { name: "開始局面" })).toBeTruthy();
    });
    it("平手から始まる手順と途中の局面から始まる手順を合わせた定跡は、平手と候補を選べる", async () => {
        const mid = ["7g7f", "3c3d", "8h2b+", "3a2b"];
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()} 1
7g7f
sfen ${key("7g7f")} 2
8c8d
sfen ${key(...mid)} 5
B*4e`);
        await built();
        const root = await screen.findByRole("combobox", { name: "開始局面" });
        expect(
            within(root)
                .getAllByRole("option")
                .map((option) => option.textContent),
        ).toEqual(["平手", "候補 1（5手目の局面）"]);
        fireEvent.change(root, { target: { value: key(...mid) } });
        expect(await tree().findByRole("button", { name: /^☗4五角打/ })).toBeTruthy();
        fireEvent.change(screen.getByRole("combobox", { name: "開始局面" }), {
            target: { value: key() },
        });
        expect(await tree().findByRole("button", { name: /^☗7六歩/ })).toBeTruthy();
    });
    it("移動の一覧から分かれ目・出口へ移り、局面を貼って探せる", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()}
7g7f none 30
2g2f none 10
sfen ${key("7g7f")}
8c8d none 40
3c3d none -20`);
        await built();
        const open = () => fireEvent.click(screen.getByRole("button", { name: "移動" }));
        const panel = () => within(screen.getByRole("dialog", { name: "局面へ移動" }));
        const items = () =>
            within(panel().getByRole("list", { name: "移る局面" }))
                .getAllByRole("button")
                .map((item) => item.textContent);
        open();
        expect(items()).toEqual(["開始局面2 通り・先に 4 手", "1 ☗7六歩(77)2 通り・先に 2 手"]);
        expect(panel().queryByRole("button", { name: /警告/ })).toBeNull();
        fireEvent.click(panel().getByRole("button", { name: /7六歩/ }));
        expect(current()).toBe("1手目 ☗7六歩(77)");
        expect(screen.queryByRole("dialog", { name: "局面へ移動" })).toBeNull();

        open();
        fireEvent.click(panel().getByRole("button", { name: "出口" }));
        fireEvent.click(panel().getByRole("button", { name: "後手よし順" }));
        expect(items()).toEqual(["2 ☖8四歩(83)-40", "1 ☗2六歩(27)10", "2 ☖3四歩(33)20"]);

        fireEvent.change(panel().getByLabelText("局面（SFEN）"), {
            target: { value: "position startpos moves 7g7f 3c3d" },
        });
        fireEvent.click(panel().getByRole("button", { name: "探す" }));
        expect(current()).toBe("2手目 ☖3四歩(33)");

        open();
        fireEvent.change(panel().getByLabelText("局面（SFEN）"), {
            target: { value: `sfen ${key("5g5f")} 2` },
        });
        fireEvent.click(panel().getByRole("button", { name: "探す" }));
        expect(panel().getByText("この局面は定跡にありません")).toBeTruthy();
    });
    it("警告のある定跡では、移動の一覧に警告の局面を出す", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()}\n7g7e\n7g7f`);
        await built();
        fireEvent.click(screen.getByRole("button", { name: "移動" }));
        const panel = within(screen.getByRole("dialog", { name: "局面へ移動" }));
        fireEvent.click(panel.getByRole("button", { name: "警告 1" }));
        expect(panel.getByText("指せない定跡の手があります")).toBeTruthy();
    });
    it("保存できなくても、しおりは開いている間は付け外しできる", async () => {
        vi.stubGlobal("localStorage", {
            getItem: () => null,
            setItem: () => {
                throw new Error("quota");
            },
        });
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()}
7g7f
2g2f
sfen ${key("7g7f")}
8c8d`);
        await built();
        const mark = () => screen.getByRole("button", { name: "しおり" });
        fireEvent.click(tree().getByRole("button", { name: /^☗7六歩/ }));
        fireEvent.click(mark());
        fireEvent.click(tree().getByRole("button", { name: /^☗2六歩/ }));
        fireEvent.click(mark());
        expect(mark().getAttribute("aria-pressed")).toBe("true");
        fireEvent.click(mark());
        expect(mark().getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(tree().getByRole("button", { name: /^☗7六歩/ }));
        expect(mark().getAttribute("aria-pressed")).toBe("true");
    });
    it("全画面で開いた移動の一覧は Esc で閉じ、全画面は閉じない", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()}
7g7f
2g2f`);
        await built();
        fireEvent.click(screen.getByRole("button", { name: "全画面" }));
        const dialog = await screen.findByRole("dialog", { name: /定跡の木/ });
        fireEvent.click(within(dialog).getByRole("button", { name: "移動" }));
        const panel = screen.getByRole("dialog", { name: "局面へ移動" });
        expect(document.activeElement).toBe(panel);
        fireEvent.keyDown(panel, { key: "Escape" });
        expect(screen.queryByRole("dialog", { name: "局面へ移動" })).toBeNull();
        expect(screen.getByRole("dialog", { name: /定跡の木/ })).toBeTruthy();
        expect(document.activeElement?.textContent).toBe("移動");
    });
    it("しおりを付けた局面を残し、移動の一覧から戻れる", async () => {
        const stored = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: (name: string) => stored.get(name) ?? null,
            setItem: (name: string, value: string) => stored.set(name, value),
        });
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()}\n7g7f\n2g2f\nsfen ${key("7g7f")}\n8c8d`);
        await built();
        fireEvent.click(tree().getByRole("button", { name: /^☗7六歩/ }));
        fireEvent.click(screen.getByRole("button", { name: "しおり" }));
        expect(screen.getByRole("button", { name: "しおり" }).getAttribute("aria-pressed")).toBe(
            "true",
        );
        expect(stored.get("book-tree-viewer:bookmarks")).toContain(key("7g7f"));
        fireEvent.click(screen.getByRole("button", { name: "開始局面へ" }));
        fireEvent.click(screen.getByRole("button", { name: "移動" }));
        const panel = within(screen.getByRole("dialog", { name: "局面へ移動" }));
        fireEvent.click(panel.getByRole("button", { name: "しおり" }));
        fireEvent.click(panel.getByRole("button", { name: /7六歩/ }));
        expect(current()).toBe("1手目 ☗7六歩(77)");
    });
    it("全画面で木を広げ、局面の欄のボタンか Esc で盤の画面に戻る", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()}
7g7f
2g2f
sfen ${key("7g7f")}
8c8d`);
        await built();
        fireEvent.click(screen.getByRole("button", { name: "全画面" }));
        const dialog = screen.getByRole("dialog", { name: "定跡の木（全画面）" });
        expect(within(dialog).getByRole("region", { name: "定跡の木" })).toBeTruthy();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "全画面" }));
        fireEvent.click(screen.getByRole("button", { name: "全画面" }));
        const reopened = screen.getByRole("dialog", { name: "定跡の木（全画面）" });
        fireEvent.click(tree().getByRole("button", { name: /^☖8四歩\(83\)/ }));
        expect(screen.getByRole("dialog")).toBeTruthy();
        fireEvent.click(within(reopened).getByRole("button", { name: "この局面を盤で開く" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(current()).toBe("2手目 ☖8四歩(83)");
    });
    it("全画面では木の横の欄に、マウスを置いた手か選んでいる手の局面を出す", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()}
7g7f
2g2f
sfen ${key("7g7f")}
8c8d`);
        await built();
        fireEvent.click(screen.getByRole("button", { name: "全画面" }));
        const dialog = screen.getByRole("dialog", { name: "定跡の木（全画面）" });
        const dock = () => within(dialog).queryByRole("complementary", { name: "局面" });
        expect(dock()?.textContent).toContain("選んでいる手");
        fireEvent.pointerMove(tree().getByRole("button", { name: /^☖8四歩\(83\)/ }), {
            pointerType: "mouse",
        });
        await waitFor(() => expect(dock()?.textContent).toContain("2手目 ☖8四歩(83)"));
        expect(dock()?.textContent).toContain("マウスを置いた手");
        fireEvent.pointerLeave(tree().getByRole("button", { name: /^☖8四歩\(83\)/ }));
        fireEvent.pointerEnter(dock() as HTMLElement);
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(dock()?.textContent).toContain("2手目 ☖8四歩(83)");
        fireEvent.pointerLeave(dock() as HTMLElement);
        await waitFor(() => expect(dock()?.textContent).toContain("選んでいる手"));
        fireEvent.click(within(dialog).getByRole("button", { name: "出さない" }));
        expect(dock()).toBeNull();
        fireEvent.click(within(dialog).getByRole("button", { name: "出す" }));
        expect(dock()?.textContent).toContain("選んでいる手");
    });
    it("登録の無い手でも定跡の局面へつながれば、登録の無い手として出す", async () => {
        render(
            <BookTreeViewer
                fetchLegalMoves={async (sfen) => (sfen === `${key()} 1` ? ["2g2f", "7g7f"] : [])}
            />,
        );
        await upload(`sfen ${key("7g7f")}\n8c8d`);
        await built();
        expect(
            moves()
                .getByText(/登録なし/)
                .closest("button")?.textContent,
        ).toContain("7六歩");
        expect(moves().queryByRole("button", { name: /2六歩/ })).toBeNull();
    });
    it("指せない定跡の手は木に入れず、その局面に警告を出す", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()}\n7g7e\n7g7f`);
        await built();
        expect(moves().getByRole("alert").textContent).toBe("指せない定跡の手があります");
        expect(moves().queryByRole("button", { name: /7五歩/ })).toBeNull();
        expect(moves().getByRole("button", { name: /7六歩/ })).toBeTruthy();
    });
    it("合流した手を選ぶと合流先の続きを出し、→ で合流先の手へ進む", async () => {
        const lines = [
            ["7g7f", "8c8d", "2g2f", "3c3d", "6g6f"],
            ["2g2f", "3c3d", "7g7f", "8c8d"],
        ];
        const entries = new Map<string, Set<string>>();
        for (const line of lines)
            for (const [index, move] of line.entries()) {
                const position = key(...line.slice(0, index));
                entries.set(position, (entries.get(position) ?? new Set()).add(move));
            }
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(
            [...entries]
                .map(([position, list]) => `sfen ${position}\n${[...list].join("\n")}`)
                .join("\n"),
        );
        await built();
        for (const name of [/2六歩/, /3四歩/, /7六歩/, /8四歩/])
            fireEvent.click(await moves().findByRole("button", { name }));
        expect(screen.getByText(/前に出た局面に合流/)).toBeTruthy();
        expect(moves().getByRole("button", { name: /6六歩/ })).toBeTruthy();
        fireEvent.keyDown(window, { key: "ArrowRight" });
        expect(current()).toBe("5手目 ☗6六歩(67)");
    });
    it("← → で手を戻し進め、↑ ↓ で同じ局面からの別の手へ移る", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()}\n7g7f\n2g2f\nsfen ${key("7g7f")}\n8c8d`);
        await built();
        fireEvent.keyDown(window, { key: "ArrowRight" });
        expect(current()).toBe("1手目 ☗7六歩(77)");
        fireEvent.keyDown(window, { key: "ArrowRight" });
        expect(current()).toBe("2手目 ☖8四歩(83)");
        fireEvent.keyDown(window, { key: "ArrowLeft" });
        fireEvent.keyDown(window, { key: "ArrowDown" });
        expect(current()).toBe("1手目 ☗2六歩(27)");
        fireEvent.keyDown(window, { key: "ArrowUp" });
        expect(current()).toBe("1手目 ☗7六歩(77)");
    });
    it("選んでいる手の祖先をたたむと、たたんだ手を選び直す", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`sfen ${key()}\n7g7f\n2g2f\nsfen ${key("7g7f")}\n8c8d`);
        await built();
        fireEvent.click(tree().getByRole("button", { name: /^☖8四歩\(83\)/ }));
        fireEvent.click(tree().getByRole("button", { name: "開始局面 の先をたたむ" }));
        expect(current()).toBe("開始局面");
        expect(tree().queryByRole("button", { name: /^☗7六歩\(77\)/ })).toBeNull();
        fireEvent.click(tree().getByRole("button", { name: /開始局面 の先を開く/ }));
        expect(tree().getByRole("button", { name: /^☖8四歩\(83\)/ })).toBeTruthy();
    });
    it("上限超過のファイルは読まず、進行中の読み込みも中止しない", async () => {
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
        await act(async () => finish(`sfen ${key()}\n7g7f`));
        await screen.findByText("pending.db");
        expect(screen.queryByText("読み込み中…")).toBeNull();
    });
    it("読み直したら、前の定跡の遅れて届いた合法手で新しい木を変えない", async () => {
        let finish: (moves: string[]) => void = () => {};
        let first = true;
        const fetch = vi.fn((sfen: string) => {
            if (sfen !== `${key()} 1` || !first) return Promise.resolve([]);
            first = false;
            return new Promise<string[]>((resolve) => {
                finish = resolve;
            });
        });
        render(
            <StrictMode>
                <BookTreeViewer fetchLegalMoves={fetch} />
            </StrictMode>,
        );
        await upload(`sfen ${key()}\n7g7f`, "old.db");
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        await upload(`sfen ${key()}\n2g2f`, "new.db");
        await built();
        await act(async () => {
            finish(["7g7f"]);
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(tree().queryByRole("button", { name: /^☗7六歩\(77\)/ })).toBeNull();
        expect(tree().getByRole("button", { name: /^☗2六歩\(27\)/ })).toBeTruthy();
    });
    it("警告のある行を数え、中身を開いて読める", async () => {
        render(<BookTreeViewer fetchLegalMoves={async () => []} />);
        await upload(`bad\nsfen ${key()}\n2g2f`);
        expect(screen.getByText("警告 1 件")).toBeTruthy();
        expect(screen.getByText(/1 行目:/)).toBeTruthy();
    });
});
