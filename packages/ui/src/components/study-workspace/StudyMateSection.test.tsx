import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../tooltip";
import { StudyMateControl, StudyMateResult, type StudyShortestProps } from "./StudyMateSection";
import { createTestStudy, TEST_LAYER_ID } from "./study-test-support";
import { buildStudyViewTree } from "./studyView";
import type { StudyMateState, StudyShortestState } from "./useStudyMate";

function renderControl(state: StudyMateState | undefined, { disabled = false } = {}) {
    const handlers = { onStart: vi.fn(), onStop: vi.fn() };
    render(<StudyMateControl state={state} disabled={disabled} {...handlers} />);
    return handlers;
}

/** 既定は ▲7六歩 △3四歩 の後 (先手番) の局面。`index` で開始局面からの手数を選ぶ。 */
function renderResult(
    state: StudyMateState | undefined,
    {
        index = 2,
        moveLabel = "☖3四歩(33)",
        shortest,
    }: { index?: number; moveLabel?: string | null; shortest?: StudyShortestProps } = {},
) {
    const { doc, ids } = createTestStudy();
    const { tree } = buildStudyViewTree(doc, TEST_LAYER_ID);
    const node = tree.nodes.get(ids[index]);
    if (!node) throw new Error("node");
    const handlers = { onPreviewPv: vi.fn(), onAddPvAsVariation: vi.fn() };
    const { container } = render(
        <TooltipProvider>
            <StudyMateResult
                node={node}
                moveLabel={moveLabel}
                state={state}
                shortest={shortest}
                {...handlers}
            />
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
        screen.getByText("☗玉に詰めろ");
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

    it("詰みは相手の玉の名前で出し、手数を言い切らずに手順と一緒に出し、盤で見られる", () => {
        // 手順の中身は表示の確認用で、詰みである必要はない
        const { node, handlers } = renderResult({
            status: "done",
            mate: { kind: "mate", pv: ["2g2f", "8c8d", "2f2e"] },
            mateMs: 450,
            threat: null,
            threatMs: null,
        });
        screen.getByText("☖玉の詰み");
        screen.getByText("あり");
        screen.getByText("（3 手・0.5 秒）");
        screen.getByText("☗が王手を続けて詰ませる手順");
        expect(screen.queryByText("☗玉に詰めろ")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "詰み手順を盤で見る" }));
        expect(handlers.onPreviewPv).toHaveBeenCalledWith({
            nodeId: node.id,
            pv: ["2g2f", "8c8d", "2f2e"],
            score: null,
        });
    });

    it("詰めろは手番の側の玉の名前で出し、直前の手が詰めろだと伝え、パスから盤で見られる", () => {
        const { node, handlers } = renderResult({
            status: "done",
            mate: { kind: "noMate" },
            mateMs: 1_000,
            threat: { kind: "mate", pv: ["2b8h+"] },
            threatMs: 2_000,
        });
        screen.getByText("☖玉の詰み");
        screen.getByText("なし");
        screen.getByText("☗玉に詰めろ");
        screen.getByText("（1 手・2.0 秒）");
        screen.getByText("☖3四歩(33) は詰めろ。☗が受けないと、次の手順で詰まされる");
        expect(screen.queryByRole("button", { name: "詰み手順を盤で見る" })).toBeNull();
        const request = { nodeId: node.id, pv: ["pass", "2b8h+"], score: null };
        fireEvent.click(screen.getByRole("button", { name: "詰めろの手順を盤で見る" }));
        expect(handlers.onPreviewPv).toHaveBeenCalledWith(request);
        fireEvent.click(screen.getByRole("button", { name: "詰めろの手順を変化として追加" }));
        expect(handlers.onAddPvAsVariation).toHaveBeenCalledWith(request);
    });

    it("後手番の局面では、先手の玉の詰みと後手の玉への詰めろを調べたことになる", () => {
        // ▲7六歩 の後 (後手番)
        renderResult(
            {
                status: "done",
                mate: { kind: "noMate" },
                mateMs: 1_000,
                threat: { kind: "mate", pv: ["8h2b+"] },
                threatMs: 2_000,
            },
            { index: 1, moveLabel: "☗7六歩(77)" },
        );
        screen.getByText("☗玉の詰み");
        screen.getByText("☖玉に詰めろ");
        screen.getByText("☗7六歩(77) は詰めろ。☖が受けないと、次の手順で詰まされる");
    });

    it("開始局面の詰めろは、直前の手を言わずに伝える", () => {
        renderResult(
            {
                status: "done",
                mate: { kind: "noMate" },
                mateMs: 1_000,
                threat: { kind: "mate", pv: ["2b8h+"] },
                threatMs: 2_000,
            },
            { index: 0, moveLabel: null },
        );
        screen.getByText("☗玉に詰めろ");
        screen.getByText("☗が受けないと、次の手順で詰まされる");
    });

    it("詰み・詰めろの言葉の説明を開ける", () => {
        renderResult({
            status: "done",
            mate: { kind: "noMate" },
            mateMs: 1_000,
            threat: { kind: "noMate" },
            threatMs: 1_000,
        });
        fireEvent.click(screen.getByText("詰み・詰めろとは"));
        screen.getByText(/受けの手を指さないと、次に詰まされる状態/);
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
                    moveLabel="☖3四歩(33)"
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

describe("最短手順", () => {
    // 手順の中身は表示の確認用で、詰みである必要はない
    const PV = ["2g2f", "8c8d", "2f2e"];
    const MATE_DONE: StudyMateState & { status: "done" } = {
        status: "done",
        mate: { kind: "mate", pv: PV },
        mateMs: 450,
        threat: null,
        threatMs: null,
    };
    const renderShortest = (
        state: StudyShortestState | undefined,
        mate: StudyMateState = MATE_DONE,
    ) => {
        const shortest = { state, disabled: false, onStart: vi.fn(), onStop: vi.fn() };
        const rendered = renderResult(mate, { shortest });
        return { ...rendered, shortest };
    };

    it("詰みがあれば求めるボタンを出す（詰みが無ければ出さない）", () => {
        const { shortest } = renderShortest(undefined);
        fireEvent.click(screen.getByRole("button", { name: "最短手順を求める" }));
        expect(shortest.onStart).toHaveBeenCalled();
    });

    it("詰みが無い局面では出さない", () => {
        renderShortest(undefined, { ...MATE_DONE, mate: { kind: "noMate" } });
        expect(screen.queryByRole("button", { name: "最短手順を求める" })).toBeNull();
    });

    it("求めている間は経過と途中で分かった手順を出し、中止できる", () => {
        const { shortest, node, handlers } = renderShortest({
            status: "running",
            nodes: 100,
            elapsedMs: 3_400,
            line: { stage: "bounded", pv: PV },
        });
        screen.getByText("最短手順を求めています（3 / 120 秒）");
        screen.getByText("3 手以内に詰むことを証明");
        expect(screen.queryByRole("button", { name: "最短手順を求める" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "最短手順を求めるのを中止" }));
        expect(shortest.onStop).toHaveBeenCalled();
        // 詰みの行と最短手順の行の両方に盤で見るボタンがある
        fireEvent.click(screen.getAllByRole("button", { name: "詰み手順を盤で見る" })[1]);
        expect(handlers.onPreviewPv).toHaveBeenCalledWith({ nodeId: node.id, pv: PV, score: null });
    });

    it("調べ直している間は、今回の手順が分かるまで前の手順を薄く出しておく", () => {
        const { container } = renderShortest({
            status: "running",
            nodes: 0,
            elapsedMs: 0,
            line: null,
            previous: { status: "done", line: { stage: "bounded", pv: PV }, elapsedMs: 9_000 },
        });
        screen.getByText("3 手以内に詰むことを証明");
        expect(container.querySelector('[aria-busy="true"].opacity-50')).not.toBeNull();
    });

    it("手順が分かる前から、手順の欄の高さを空けておく", () => {
        const { container } = renderShortest({
            status: "running",
            nodes: 0,
            elapsedMs: 0,
            line: null,
        });
        const placeholder = container.querySelector('[aria-hidden="true"].invisible');
        expect(placeholder?.textContent).toContain("推定した手順");
        // 空けた欄のボタンは押せない
        expect(screen.getAllByRole("button", { name: "詰み手順を盤で見る" })).toHaveLength(1);
    });

    it("失敗で終わっても、欄の高さは空けたままにする", () => {
        const { container } = renderShortest({
            status: "error",
            message: "最短手順を求められませんでした",
        });
        expect(screen.getByRole("alert").textContent).toBe("最短手順を求められませんでした");
        expect(container.querySelector('[aria-hidden="true"].invisible')).not.toBeNull();
    });

    it("分かった手順を残して失敗したときは、手順と理由を出す", () => {
        renderShortest({
            status: "done",
            line: { stage: "bounded", pv: PV },
            elapsedMs: 1_000,
            message: "最短手順を求められませんでした",
        });
        screen.getByText("3 手以内に詰むことを証明");
        expect(screen.getByRole("alert").textContent).toBe("最短手順を求められませんでした");
    });

    it("調べ直しで前より弱い段階の手順が届いても、前の手順を出しておく", () => {
        const { container } = renderShortest({
            status: "running",
            nodes: 1,
            elapsedMs: 1_000,
            line: { stage: "estimated", pv: PV },
            previous: { status: "done", line: { stage: "bounded", pv: PV }, elapsedMs: 9_000 },
        });
        screen.getByText("3 手以内に詰むことを証明");
        expect(screen.queryByText("推定した手順（3 手、未証明）")).toBeNull();
        expect(container.querySelector('[aria-busy="true"].opacity-50')).not.toBeNull();
    });

    it("調べ直しで前より進んだ手順が届いたら、それを出す", () => {
        const { container } = renderShortest({
            status: "running",
            nodes: 1,
            elapsedMs: 1_000,
            line: { stage: "bounded", pv: PV },
            previous: { status: "done", line: { stage: "estimated", pv: PV }, elapsedMs: 9_000 },
        });
        screen.getByText("3 手以内に詰むことを証明");
        expect(container.querySelector('[aria-busy="true"].opacity-50')).toBeNull();
    });

    it("推定した手順は未証明と伝える", () => {
        renderShortest({
            status: "running",
            nodes: 100,
            elapsedMs: 1_000,
            line: { stage: "estimated", pv: PV },
        });
        screen.getByText("推定した手順（3 手、未証明）");
    });

    it("最短を証明したら手数を言い切り、ボタンを出さない", () => {
        renderShortest({
            status: "done",
            line: { stage: "proven", pv: ["2g2f"] },
            elapsedMs: 5_000,
        });
        screen.getByText("最短 1 手（証明済み）");
        screen.getByText("☗が王手を続けて詰ませる手順");
        screen.getByText("詰将棋のルールの手順なので、最後に受け方の無駄合いが残ることがあります");
        expect(screen.queryByRole("button", { name: "最短手順を求める" })).toBeNull();
    });

    it("証明した最短手順が詰みの手順と同じなら、詰みの行に最短と書き添えて 1 つにまとめる", () => {
        renderShortest({ status: "done", line: { stage: "proven", pv: PV }, elapsedMs: 5_000 });
        screen.getByText("最短と証明した詰み手順");
        screen.getByText("詰将棋のルールの手順なので、最後に受け方の無駄合いが残ることがあります");
        expect(screen.queryByText("最短手順")).toBeNull();
        expect(screen.queryByText("最短 3 手（証明済み）")).toBeNull();
        expect(screen.getAllByRole("button", { name: "詰み手順を盤で見る" })).toHaveLength(1);
    });

    it("最短手順が詰みの手順と同じ手数でも、手順が違えば 2 段のまま出す", () => {
        renderShortest({
            status: "done",
            line: { stage: "proven", pv: ["2g2f", "8c8d", "2f2d"] },
            elapsedMs: 5_000,
        });
        screen.getByText("☗が王手を続けて詰ませる手順");
        screen.getByText("最短 3 手（証明済み）");
    });

    it("求め終わらなかったら、分かったところまでの手順を残して、そう伝える", () => {
        renderShortest({ status: "done", line: { stage: "bounded", pv: PV }, elapsedMs: 120_000 });
        screen.getByText("3 手以内に詰むことを証明");
        screen.getByText("求め終わりませんでした");
        screen.getByRole("button", { name: "最短手順を求める" });
    });

    it("手順が分からないまま終わったら、時間切れと決めつけずに伝える", () => {
        const { container } = renderShortest({ status: "done", line: null, elapsedMs: 120_000 });
        screen.getByText("求め終わりませんでした");
        // 手順は無いが、求めていた間の欄の高さは空けたままにする
        expect(container.querySelector('[aria-hidden="true"].invisible')).not.toBeNull();
    });

    it("詰み・詰めろを調べ直している間は押せない", () => {
        renderShortest(undefined, {
            status: "running",
            phase: "mate",
            nodes: 1,
            elapsedMs: 1,
            previous: MATE_DONE,
        });
        expect(
            (screen.getByRole("button", { name: "最短手順を求める" }) as HTMLButtonElement)
                .disabled,
        ).toBe(true);
    });
});
