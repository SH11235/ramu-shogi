import { describe, expect, it, vi } from "vitest";
import { applyMoveWithState, createInitialPositionState } from "../game/board";
import { parseBook, parseBookAsync, positionToBookKey } from "./book";
import { bookTreePath, bookTreeRow, createBookTreeBuilder } from "./tree";

const initial = createInitialPositionState();
function after(...moves: string[]) {
    return moves.reduce((position, move) => applyMoveWithState(position, move).next, initial);
}
const key = (...moves: string[]) => positionToBookKey(after(...moves));
const first = ["7g7f", "8c8d", "2g2f", "3c3d"];
const second = ["2g2f", "3c3d", "7g7f", "8c8d"];
function fixture() {
    const text = `sfen ${key()}\n7g7f\n2g2f\nsfen ${key(...first.slice(0, 2))}\n2g2f\nsfen ${key(...second.slice(0, 2))}\n7g7f\nsfen ${key(...first)}\n6g6f`;
    const responses = new Map<string, string[]>();
    for (const line of [first, second])
        for (const length of [1, 3])
            responses.set(`${key(...line.slice(0, length))} 1`, [line[length], "4c4d"]);
    return {
        book: parseBook(text),
        legalMoves: vi.fn(async (sfen: string) => responses.get(sfen) ?? []),
    };
}

describe("book tree", () => {
    it("中止後は予約済みの展開も通知も木の変更もしない", async () => {
        let finish: (moves: string[]) => void = () => {};
        const legalMoves = vi.fn(
            () =>
                new Promise<string[]>((resolve) => {
                    finish = resolve;
                }),
        );
        const onChange = vi.fn();
        const builder = createBookTreeBuilder({
            ...fixture(),
            side: "sente",
            legalMoves,
            onChange,
        });
        const started = builder.start();
        await vi.waitFor(() => expect(legalMoves).toHaveBeenCalledOnce());
        const queued = builder.expandFrom(2);
        builder.cancel();
        const snapshot = structuredClone(builder.tree);
        onChange.mockClear();
        finish(["8c8d"]);
        await Promise.all([started, queued]);
        expect(onChange).not.toHaveBeenCalled();
        expect(builder.tree).toEqual(snapshot);
        expect(legalMoves).toHaveBeenCalledOnce();
    });
    it("幅優先で定跡順・接続する合法手を展開し、合流を葉にして最初の手順を返す", async () => {
        const input = fixture();
        const builder = createBookTreeBuilder({ ...input, side: "sente" });
        await builder.start();
        const { tree } = builder;
        expect(tree.nodes[0].children.map((id) => tree.nodes[id].move)).toEqual(["7g7f", "2g2f"]);
        expect(input.legalMoves.mock.calls.slice(0, 2).map(([sfen]) => sfen)).toEqual([
            `${key("7g7f")} 1`,
            `${key("2g2f")} 1`,
        ]);
        const merge = tree.nodes.find((node) => node.status === "merge");
        expect(merge).toBeDefined();
        expect(merge?.children).toEqual([]);
        expect(
            bookTreePath(tree, merge?.id ?? -1)
                .slice(1)
                .map((node) => node.move),
        ).toEqual(first);
        expect(
            tree.nodes.filter((node) => node.key === key(...first) && node.status !== "merge"),
        ).toHaveLength(1);
        expect(tree.complete).toBe(true);
        expect(tree.unreachable).toEqual([]);
        expect(bookTreeRow(tree, 0).map((node) => node.id)).toEqual([0]);
        expect(bookTreeRow(tree, tree.nodes[0].children[0]).map((node) => node.move)).toEqual([
            ...first,
            "6g6f",
        ]);
        expect(new Set(input.legalMoves.mock.calls.map(([sfen]) => sfen)).size).toBe(
            input.legalMoves.mock.calls.length,
        );
    });
    it("後手の木は根の合法手から後手定跡へ接続する", async () => {
        const legalMoves = vi.fn(async () => ["2g2f", "7g7f"]);
        const builder = createBookTreeBuilder({
            book: parseBook(`sfen ${key("7g7f")}\n8c8d`),
            side: "gote",
            legalMoves,
        });
        await builder.start();
        expect(bookTreeRow(builder.tree, 0).map((node) => node.move)).toEqual([
            undefined,
            "7g7f",
            "8c8d",
        ]);
        expect(legalMoves).toHaveBeenCalledTimes(2);
    });
    it("上限では未展開を残し、その枝だけを追加展開する", async () => {
        const builder = createBookTreeBuilder({ ...fixture(), side: "sente", limit: 1 });
        await builder.start();
        expect(builder.tree.expanded).toBe(1);
        expect(builder.tree.capped).toBe(true);
        expect(builder.tree.complete).toBe(false);
        expect(builder.tree.nodes[1].status).toBe("pending");
        const previous = builder.tree.nodes[1];
        await builder.expandFrom(1);
        expect(previous.status).toBe("pending");
        expect(previous.children).toEqual([]);
        expect(builder.tree.nodes[1].status).toBe("ready");
        expect(builder.tree.nodes[2].status).toBe("pending");
        expect(builder.tree.nodes[1].children).toHaveLength(1);
    });
    it("古い非同期結果を破棄し、新しい木だけを構築する", async () => {
        let resolve: (moves: string[]) => void = () => {};
        const legalMoves = vi.fn(
            () =>
                new Promise<string[]>((done) => {
                    resolve = done;
                }),
        );
        const old = createBookTreeBuilder({ ...fixture(), side: "sente", legalMoves });
        const pending = old.start();
        await vi.waitFor(() => expect(legalMoves).toHaveBeenCalledOnce());
        old.cancel();
        const fresh = createBookTreeBuilder({ book: parseBook(""), side: "sente", legalMoves });
        await fresh.start();
        resolve(["8c8d"]);
        await pending;
        expect(old.tree.nodes).toHaveLength(3);
        expect(fresh.tree.nodes).toHaveLength(1);
        expect(legalMoves).toHaveBeenCalledOnce();
    });
    it("開始前の中止と複数回の start は二重構築しない", async () => {
        const input = fixture();
        const cancelled = createBookTreeBuilder({ ...input, side: "gote" });
        const pending = cancelled.start();
        cancelled.cancel();
        await pending;
        expect(input.legalMoves).not.toHaveBeenCalled();
        const builder = createBookTreeBuilder({ ...input, side: "sente" });
        expect(builder.start()).toBe(builder.start());
        await builder.start();
        expect(builder.tree.complete).toBe(true);
    });
    it("合法手の失敗をノードに記録し、他の枝の展開を続ける", async () => {
        const input = fixture();
        const builder = createBookTreeBuilder({
            ...input,
            side: "sente",
            legalMoves: async (sfen) => {
                if (sfen === `${key("7g7f")} 1`) throw new Error("unavailable");
                return input.legalMoves(sfen);
            },
        });
        await builder.start();
        expect(builder.tree.complete).toBe(false);
        expect(builder.tree.unreachable).toEqual([]);
        expect(builder.tree.legalMovesFailed).toBe(true);
        expect(builder.tree.nodes[1].status).toBe("error");
        expect(builder.tree.nodes[1].error).toContain("合法手");
        expect(builder.tree.firstByKey.has(key(...second))).toBe(true);
    });
    it("到達不能は完了時だけ、見る側の局面を数える", async () => {
        const builder = createBookTreeBuilder({
            book: parseBook(`sfen ${key(...first)}\n6g6f\nsfen ${key("7g7f")}\n8c8d`),
            side: "sente",
            legalMoves: async () => [],
        });
        await builder.start();
        expect(builder.tree.unreachable).toEqual([key(...first)]);
    });
    it("分割パースは同期版と一致し、途中で中止できる", async () => {
        const text = `sfen ${key()}\n7g7f\n${"# comment\n".repeat(600)}sfen ${key("7g7f")}\n8c8d`;
        expect(await parseBookAsync(text)).toEqual(parseBook(text));
        await expect(parseBookAsync(text, () => true)).rejects.toThrow("中止");
    });
});
