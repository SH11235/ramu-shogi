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
    it.each([
        { moves: [], illegal: "7g7e", legal: "7g7f" },
        {
            moves: ["7g7f", "7c7d", "7f7e", "7d7e", "2g2f"],
            illegal: "P*3d",
            legal: "8c8d",
        },
    ])("違法手 $illegal を除外して合法な子を残す", async ({ moves, illegal, legal }) => {
        const entries = moves.map(
            (move, index) => `sfen ${key(...moves.slice(0, index))}\n${move}`,
        );
        entries.push(`sfen ${key(...moves)}\n${illegal}\n${legal}`);
        const responses = new Map(
            moves.map((move, index) => [`${key(...moves.slice(0, index))} 1`, [move]]),
        );
        const legalMoves = vi.fn(async (sfen: string) => responses.get(sfen) ?? []);
        const builder = createBookTreeBuilder({
            book: parseBook(entries.join("\n")),
            legalMoves,
        });
        await builder.start();
        const node = builder.tree.nodes.find((node) => node.key === key(...moves));
        expect(node).toMatchObject({ status: "error", error: "指せない定跡の手があります" });
        expect(node?.children.map((id) => builder.tree.nodes[id].move)).toEqual([legal]);
        expect(builder.tree.nodes.some((node) => node.move === illegal)).toBe(false);
        expect(builder.tree.legalMovesFailed).toBe(false);
    });
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
        const builder = createBookTreeBuilder(input);
        await builder.start();
        const { tree } = builder;
        expect(tree.nodes[0].children.map((id) => tree.nodes[id].move)).toEqual(["7g7f", "2g2f"]);
        expect(input.legalMoves.mock.calls.slice(0, 3).map(([sfen]) => sfen)).toEqual([
            `${key()} 1`,
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
        expect(tree.building).toBe(false);
        expect(bookTreeRow(tree, 0).map((node) => node.id)).toEqual([0]);
        expect(bookTreeRow(tree, tree.nodes[0].children[0]).map((node) => node.move)).toEqual([
            ...first,
            "6g6f",
        ]);
        expect(new Set(input.legalMoves.mock.calls.map(([sfen]) => sfen)).size).toBe(
            input.legalMoves.mock.calls.length,
        );
    });
    it("登録の無い手でも定跡の局面へつながれば子にし、登録の手と見分ける", async () => {
        const legalMoves = vi.fn(async (sfen: string) =>
            sfen === `${key()} 1` ? ["2g2f", "7g7f"] : [],
        );
        const builder = createBookTreeBuilder({
            book: parseBook(`sfen ${key("7g7f")}\n8c8d`),
            legalMoves,
        });
        await builder.start();
        const row = bookTreeRow(builder.tree, 0);
        expect(row.map((node) => node.move)).toEqual([undefined, "7g7f", "8c8d"]);
        expect(row.map((node) => node.inBook)).toEqual([undefined, false, true]);
    });
    it("登録の手は手番側から見て良い順に並べ、同じ値はファイルの順にする", async () => {
        const text = `sfen ${key("7g7f")}
8c8d none -50
3c3d none 20
4c4d none -50
1c1d none 80`;
        const builder = createBookTreeBuilder({
            book: parseBook(text),
            legalMoves: async (sfen) => (sfen === `${key()} 1` ? ["7g7f"] : []),
        });
        await builder.start();
        const parent = builder.tree.nodes.find((node) => node.key === key("7g7f"));
        expect(parent?.children.map((id) => builder.tree.nodes[id].move)).toEqual([
            "1c1d",
            "3c3d",
            "8c8d",
            "4c4d",
        ]);
    });
    it("上限では未展開を残し、その枝だけを追加展開する", async () => {
        const builder = createBookTreeBuilder({ ...fixture(), limit: 1 });
        await builder.start();
        expect(builder.tree.expanded).toBe(1);
        expect(builder.tree.capped).toBe(true);
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
        const old = createBookTreeBuilder({ ...fixture(), legalMoves });
        const pending = old.start();
        await vi.waitFor(() => expect(legalMoves).toHaveBeenCalledOnce());
        old.cancel();
        const fresh = createBookTreeBuilder({
            book: parseBook(""),
            legalMoves: async () => ["7g7f"],
        });
        await fresh.start();
        resolve(["8c8d"]);
        await pending;
        expect(old.tree.nodes).toHaveLength(1);
        expect(old.tree.expanded).toBe(0);
        expect(fresh.tree.nodes).toHaveLength(1);
        expect(legalMoves).toHaveBeenCalledOnce();
    });
    it("開始前の中止と複数回の start は二重構築しない", async () => {
        const input = fixture();
        const cancelled = createBookTreeBuilder(input);
        const pending = cancelled.start();
        cancelled.cancel();
        await pending;
        expect(input.legalMoves).not.toHaveBeenCalled();
        const builder = createBookTreeBuilder(input);
        expect(builder.start()).toBe(builder.start());
        await builder.start();
        expect(builder.tree.building).toBe(false);
    });
    it("合法手の失敗をノードに記録し、他の枝の展開を続ける", async () => {
        const input = fixture();
        const builder = createBookTreeBuilder({
            ...input,
            legalMoves: async (sfen) => {
                if (sfen === `${key("7g7f")} 1`) throw new Error("unavailable");
                return input.legalMoves(sfen);
            },
        });
        await builder.start();
        expect(builder.tree.legalMovesFailed).toBe(true);
        expect(builder.tree.nodes[1].status).toBe("error");
        expect(builder.tree.nodes[1].error).toContain("合法手");
        expect(builder.tree.firstByKey.has(key(...second))).toBe(true);
    });
    it("分割パースは同期版と一致し、途中で中止できる", async () => {
        const text = `sfen ${key()}\n7g7f\n${"# comment\n".repeat(600)}sfen ${key("7g7f")}\n8c8d`;
        expect(await parseBookAsync(text)).toEqual(parseBook(text));
        await expect(parseBookAsync(text, () => true)).rejects.toThrow("中止");
    });
    it("平手から定跡に入れない定跡は、他の局面から来ていない局面を手数の小さい順に開始局面の候補にする", async () => {
        const mid = ["7g7f", "3c3d", "8h2b+", "3a2b"];
        const text = `sfen ${key(...mid)} 5
B*4e
sfen ${key(...mid, "B*4e")} 6
8c8d
sfen ${key("2g2f", "8c8d")} 3
2f2e`;
        const builder = createBookTreeBuilder({
            book: parseBook(text),
            legalMoves: async (sfen) => (sfen === `${key()} 1` ? ["7g7f", "2g2f"] : []),
        });
        await builder.start();
        expect(builder.tree.roots).toEqual([key("2g2f", "8c8d"), key(...mid)]);
        expect(builder.tree.nodes[0].key).toBe(key("2g2f", "8c8d"));
        expect(builder.tree.nodes[0].position.ply).toBe(3);

        const chosen = createBookTreeBuilder({
            book: parseBook(text),
            legalMoves: async () => [],
            rootKey: key(...mid),
        });
        await chosen.start();
        expect(chosen.tree.nodes[0].position.ply).toBe(5);
        expect(bookTreeRow(chosen.tree, 0).map((node) => node.move)).toEqual([
            undefined,
            "B*4e",
            "8c8d",
        ]);
    });
    it("合法手を取れなくても、定跡の中の局面から始める", async () => {
        const builder = createBookTreeBuilder({
            book: parseBook(`sfen ${key("7g7f", "3c3d")}\n2g2f`),
            legalMoves: async () => {
                throw new Error("unavailable");
            },
        });
        await builder.start();
        expect(builder.tree.nodes[0].key).toBe(key("7g7f", "3c3d"));
        expect(builder.tree.nodes.map((node) => node.move)).toEqual([undefined, "2g2f"]);
    });
    it("手順が輪になっていて他から来ていない局面が無ければ、最初の局面から始める", async () => {
        const base = ["7g7f", "3c3d"];
        const loop = ["5i5h", "5a5b", "5h5i", "5b5a"];
        const text = loop
            .map((move, index) => `sfen ${key(...base, ...loop.slice(0, index))}\n${move}`)
            .join("\n");
        const builder = createBookTreeBuilder({
            book: parseBook(text),
            legalMoves: async () => [],
        });
        await builder.start();
        expect(builder.tree.roots).toEqual([key(...base)]);
        expect(builder.tree.nodes.map((node) => node.status)).toEqual([
            "ready",
            "ready",
            "ready",
            "ready",
            "merge",
        ]);
    });
});
