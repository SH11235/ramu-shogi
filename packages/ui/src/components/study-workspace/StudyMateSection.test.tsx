import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../tooltip";
import { StudyMateControl, StudyMateResult } from "./StudyMateSection";
import { createTestStudy, TEST_LAYER_ID } from "./study-test-support";
import { buildStudyViewTree } from "./studyView";
import type { StudyMateState } from "./useStudyMate";

function renderControl(
    state: StudyMateState | undefined,
    { busyElsewhere = false, disabled = false } = {},
) {
    const handlers = { onStart: vi.fn(), onStop: vi.fn() };
    render(
        <StudyMateControl
            state={state}
            busyElsewhere={busyElsewhere}
            disabled={disabled}
            {...handlers}
        />,
    );
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
    it("調べる前は「詰みを調べる」だけを出す", () => {
        const handlers = renderControl(undefined);
        fireEvent.click(screen.getByRole("button", { name: "詰みを調べる" }));
        expect(handlers.onStart).toHaveBeenCalled();
    });

    it("解析が動いている間は押せない", () => {
        renderControl(undefined, { disabled: true });
        expect(
            (screen.getByRole("button", { name: "詰みを調べる" }) as HTMLButtonElement).disabled,
        ).toBe(true);
    });

    it("調べている間は途中経過と中止を出す", () => {
        const handlers = renderControl({
            status: "running",
            phase: "threat",
            nodes: 1_234_567,
            elapsedMs: 3_200,
        });
        screen.getByText("詰めろを調べています（3 秒・123 万局面）");
        fireEvent.click(screen.getByRole("button", { name: "詰み探索を中止" }));
        expect(handlers.onStop).toHaveBeenCalled();
    });

    it("別の局面を調べている間は、そう伝えて中止できる", () => {
        const handlers = renderControl(undefined, { busyElsewhere: true });
        screen.getByText("別の局面の詰みを調べています");
        expect(screen.queryByRole("button", { name: "詰みを調べる" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "詰み探索を中止" }));
        expect(handlers.onStop).toHaveBeenCalled();
    });
});

describe("StudyMateResult", () => {
    it("調べていない・調べている途中は何も出さない", () => {
        expect(renderResult(undefined).container.textContent).toBe("");
    });

    it("途中経過は結果の場所に出さない", () => {
        const { container } = renderResult({
            status: "running",
            phase: "mate",
            nodes: 0,
            elapsedMs: 0,
        });
        expect(container.textContent).toBe("");
    });

    it("詰みは手数を言い切らずに手順と一緒に出し、盤で見られる", () => {
        // ▲7六歩 △3四歩 の後 (先手番)。手順の中身は表示の確認用で、詰みである必要はない
        const { node, handlers } = renderResult({
            status: "done",
            mate: { kind: "mate", pv: ["2g2f", "8c8d", "2f2e"] },
            threat: null,
        });
        screen.getByText("あり");
        screen.getByText("（☗の詰み・3 手の手順）");
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
            threat: { kind: "mate", pv: ["2b8h+"] },
        });
        screen.getByText("なし");
        screen.getByText("詰めろ");
        screen.getByText("（☖の詰み・1 手の手順）");
        // 詰めろの手順は手番を渡した局面からなので、盤で見る・変化に足す操作は出さない
        expect(screen.queryByRole("button", { name: "詰み手順を盤で見る" })).toBeNull();
    });

    it("時間内に読み切れなければ、そう伝える", () => {
        renderResult({ status: "done", mate: { kind: "unknown" }, threat: { kind: "unknown" } });
        expect(screen.getAllByText("10 秒では読み切れませんでした")).toHaveLength(2);
    });

    it("エラーは結果の場所に出す", () => {
        renderResult({ status: "error", message: "このエンジンでは詰み探索を使えません" });
        expect(screen.getByRole("alert").textContent).toBe("このエンジンでは詰み探索を使えません");
    });
});
