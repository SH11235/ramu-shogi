import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../tooltip";
import { StudyMateControl, StudyMateResult } from "./StudyMateSection";
import { createTestStudy, TEST_LAYER_ID } from "./study-test-support";
import { buildStudyViewTree } from "./studyView";
import type { StudyMateState } from "./useStudyMate";

function renderControl(state: StudyMateState | undefined, { disabled = false } = {}) {
    const handlers = { onStart: vi.fn(), onStop: vi.fn() };
    render(<StudyMateControl state={state} disabled={disabled} {...handlers} />);
    return handlers;
}

function renderResult(state: StudyMateState | undefined) {
    const { doc, ids } = createTestStudy();
    const { tree } = buildStudyViewTree(doc, TEST_LAYER_ID);
    const node = tree.nodes.get(ids[2]);
    if (!node) throw new Error("node");
    const handlers = { onPreviewPv: vi.fn(), onAddPvAsVariation: vi.fn() };
    const { container } = render(
        <TooltipProvider>
            <StudyMateResult node={node} state={state} {...handlers} />
        </TooltipProvider>,
    );
    return { node, handlers, container };
}

describe("StudyMateControl", () => {
    it("調べる前は「詰みを読む」だけを出す", () => {
        const handlers = renderControl(undefined);
        fireEvent.click(screen.getByRole("button", { name: "詰みを読む" }));
        expect(handlers.onStart).toHaveBeenCalled();
    });

    it("解析が動いている間は押せない", () => {
        renderControl(undefined, { disabled: true });
        expect(
            (screen.getByRole("button", { name: "詰みを読む" }) as HTMLButtonElement).disabled,
        ).toBe(true);
    });

    it("調べている間は中止に替わる", () => {
        const handlers = renderControl({
            status: "running",
            phase: "threat",
            nodes: 1_234_567,
            elapsedMs: 3_200,
        });
        fireEvent.click(screen.getByRole("button", { name: "詰み探索を中止" }));
        expect(handlers.onStop).toHaveBeenCalled();
    });
});

describe("StudyMateResult", () => {
    it("調べていない局面は何も出さない", () => {
        expect(renderResult(undefined).container.textContent).toBe("");
    });

    it("調べている間は、上限と合わせた経過を見出しに出す", () => {
        renderResult({ status: "running", phase: "threat", nodes: 1_234, elapsedMs: 3_200 });
        screen.getByText("詰めろを調べています（3 / 10 秒）");
    });

    it("エンジンの起動を待つ間は秒数を出さない", () => {
        renderResult({ status: "running", phase: "mate", nodes: 0, elapsedMs: 0 });
        screen.getByText("詰みを調べています");
    });

    it("調べ直している間は前の結果を出しておく", () => {
        renderResult({
            status: "running",
            phase: "mate",
            nodes: 0,
            elapsedMs: 0,
            previous: {
                status: "done",
                mate: { kind: "noMate" },
                mateMs: 1_200,
                threat: { kind: "noMate" },
                threatMs: 300,
            },
        });
        screen.getByText("詰めろ");
        expect(screen.getAllByText("なし")).toHaveLength(2);
    });

    it("詰みが無いと読み切ったら、掛かった時間を添える（一瞬でも 0 秒とは書かない）", () => {
        renderResult({
            status: "done",
            mate: { kind: "noMate" },
            mateMs: 1_840,
            threat: { kind: "noMate" },
            threatMs: 20,
        });
        screen.getByText("（読み切り・1.8 秒）");
        screen.getByText("（読み切り・0.1 秒未満）");
        screen.getByText("（詰み・詰めろをそれぞれ最大 10 秒）");
    });

    it("詰みは手数を言い切らずに手順と一緒に出し、盤で見られる", () => {
        // ▲7六歩 △3四歩 の後 (先手番)。手順の中身は表示の確認用で、詰みである必要はない
        const { node, handlers } = renderResult({
            status: "done",
            mate: { kind: "mate", pv: ["2g2f", "8c8d", "2f2e"] },
            mateMs: 450,
            threat: null,
            threatMs: null,
        });
        screen.getByText("あり");
        screen.getByText("（☗の詰み・3 手・0.5 秒）");
        expect(screen.queryByText("詰めろ")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "詰み手順を盤で見る" }));
        expect(handlers.onPreviewPv).toHaveBeenCalledWith({
            nodeId: node.id,
            pv: ["2g2f", "8c8d", "2f2e"],
            score: null,
        });
    });

    it("詰みが無ければ、詰めろの結果を相手の詰みとして出す", () => {
        renderResult({
            status: "done",
            mate: { kind: "noMate" },
            mateMs: 1_000,
            threat: { kind: "mate", pv: ["2b8h+"] },
            threatMs: 2_000,
        });
        screen.getByText("なし");
        screen.getByText("詰めろ");
        screen.getByText("（☖の詰み・1 手・2.0 秒）");
        // 詰めろの手順は手番を渡した局面からなので、盤で見る・変化に足す操作は出さない
        expect(screen.queryByRole("button", { name: "詰み手順を盤で見る" })).toBeNull();
    });

    it("扱えない局面は、相手の玉の有無で理由を分けて伝える", () => {
        const { node, handlers } = renderResult({
            status: "done",
            mate: { kind: "unsupported" },
            mateMs: 0,
            threat: null,
            threatMs: null,
        });
        screen.getByText(
            "王手を放置した局面（手番でない側の玉に王手が掛かっている）は調べられません",
        );

        const board = { ...node.positionAfter.board };
        for (const [square, piece] of Object.entries(board)) {
            if (piece?.type === "K" && piece.owner !== node.positionAfter.turn) {
                board[square as keyof typeof board] = null;
            }
        }
        render(
            <TooltipProvider>
                <StudyMateResult
                    node={{ ...node, positionAfter: { ...node.positionAfter, board } }}
                    state={{
                        status: "done",
                        mate: { kind: "unsupported" },
                        mateMs: 0,
                        threat: null,
                        threatMs: null,
                    }}
                    {...handlers}
                />
            </TooltipProvider>,
        );
        screen.getByText("相手の玉が無い局面は調べられません");
    });

    it("時間内に読み切れなければ、そう伝える", () => {
        renderResult({
            status: "done",
            mate: { kind: "unknown" },
            mateMs: 10_000,
            threat: { kind: "unknown" },
            threatMs: 10_000,
        });
        expect(screen.getAllByText("10 秒では読み切れませんでした")).toHaveLength(2);
    });

    it("エラーは結果の場所に出す", () => {
        renderResult({ status: "error", message: "このエンジンでは詰み探索を使えません" });
        expect(screen.getByRole("alert").textContent).toBe("このエンジンでは詰み探索を使えません");
    });
});
