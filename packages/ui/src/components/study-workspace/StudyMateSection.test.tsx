import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../tooltip";
import { StudyMateSection } from "./StudyMateSection";
import { createTestStudy, TEST_LAYER_ID } from "./study-test-support";
import { buildStudyViewTree } from "./studyView";
import type { StudyMateState } from "./useStudyMate";

function renderSection(state: StudyMateState | undefined, busyElsewhere = false) {
    const { doc, ids } = createTestStudy();
    const { tree } = buildStudyViewTree(doc, TEST_LAYER_ID);
    const node = tree.nodes.get(ids[2]);
    if (!node) throw new Error("node");
    const handlers = {
        onStart: vi.fn(),
        onStop: vi.fn(),
        onPreviewPv: vi.fn(),
        onAddPvAsVariation: vi.fn(),
    };
    render(
        <TooltipProvider>
            <StudyMateSection
                node={node}
                state={state}
                busyElsewhere={busyElsewhere}
                {...handlers}
            />
        </TooltipProvider>,
    );
    return { node, handlers };
}

describe("StudyMateSection", () => {
    it("調べる前は「詰みを調べる」を出す", () => {
        const { handlers } = renderSection(undefined);
        fireEvent.click(screen.getByRole("button", { name: "詰みを調べる" }));
        expect(handlers.onStart).toHaveBeenCalled();
    });

    it("別の局面を調べている間は、そう伝えて中止できる", () => {
        const { handlers } = renderSection(undefined, true);
        screen.getByText("別の局面の詰みを調べています");
        expect(screen.queryByRole("button", { name: "詰みを調べる" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "詰み探索を中止" }));
        expect(handlers.onStop).toHaveBeenCalled();
    });

    it("調べている間は途中経過と中止を出す", () => {
        const { handlers } = renderSection({
            status: "running",
            phase: "threat",
            nodes: 1_234_567,
            elapsedMs: 3_200,
        });
        screen.getByText("詰めろを調べています（3 秒・123 万局面）");
        fireEvent.click(screen.getByRole("button", { name: "詰み探索を中止" }));
        expect(handlers.onStop).toHaveBeenCalled();
    });

    it("詰みは手数を言い切らずに手順と一緒に出し、盤で見られる", () => {
        // ▲7六歩 △3四歩 の後 (先手番)。手順の中身は表示の確認用で、詰みである必要はない
        const { node, handlers } = renderSection({
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
        renderSection({
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
        renderSection({ status: "done", mate: { kind: "unknown" }, threat: { kind: "unknown" } });
        expect(screen.getAllByText("10 秒では読み切れませんでした")).toHaveLength(2);
    });
});
