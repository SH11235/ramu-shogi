import { applyMoveWithState, createInitialPositionState, positionToBookKey } from "@shogi/app-core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookTreeViewer, MAX_BOOK_FILE_BYTES } from "./BookTreeViewer";

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
    it("全画面で木を広げ、手のダブルクリックか Esc で盤の画面に戻る", async () => {
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
        fireEvent.doubleClick(tree().getByRole("button", { name: /^☖8四歩\(83\)/ }));
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
        fireEvent.click(within(dialog).getByRole("button", { name: "浮かせる" }));
        expect(dock()).toBeNull();
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
