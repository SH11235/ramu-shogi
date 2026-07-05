import { createInitialPositionState } from "@shogi/app-core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useKifuNavigation } from "./useKifuNavigation";

const setup = () =>
    renderHook(() =>
        useKifuNavigation({
            initialPosition: createInitialPositionState(),
            initialSfen: "startpos",
        }),
    );

describe("useKifuNavigation", () => {
    it("recordEvalByPly は normalized を KifuEval に転送する", () => {
        const { result } = setup();

        act(() => {
            result.current.addMove("7g7f", createInitialPositionState());
        });
        act(() => {
            result.current.recordEvalByPly(1, {
                type: "info",
                scoreCp: 123,
                depth: 10,
                multipv: 1,
                normalized: true,
            });
        });

        const node = [...result.current.tree.nodes.values()].find((n) => n.ply === 1);
        expect(node?.eval).toMatchObject({ scoreCp: 123, normalized: true });
        expect(node?.multiPvEvals?.[0]).toMatchObject({ scoreCp: 123, normalized: true });
    });

    it("recordEvalByNodeId は normalized を KifuEval に転送する", () => {
        const { result } = setup();

        act(() => {
            result.current.addMove("7g7f", createInitialPositionState());
        });
        const nodeId = result.current.tree.currentNodeId;

        act(() => {
            result.current.recordEvalByNodeId(nodeId, {
                type: "info",
                scoreMate: 5,
                depth: 12,
                multipv: 1,
                normalized: true,
            });
        });

        const node = result.current.tree.nodes.get(nodeId);
        expect(node?.eval).toMatchObject({ scoreMate: 5, normalized: true });
        expect(node?.multiPvEvals?.[0]).toMatchObject({ scoreMate: 5, normalized: true });
    });

    it("updateMoveEvalAtPly は本譜ノードへ normalized:true の評価値と消費時間を差分適用する", () => {
        const { result } = setup();

        act(() => {
            result.current.addMove("7g7f", createInitialPositionState());
        });
        const nodeId = result.current.tree.currentNodeId;

        act(() => {
            result.current.updateMoveEvalAtPly(
                1,
                {
                    elapsedMs: 1200,
                    scoreCp: 234,
                },
                {
                    usiMove: "7g7f",
                },
            );
        });

        const node = result.current.tree.nodes.get(nodeId);
        expect(node?.elapsedMs).toBe(1200);
        expect(node?.eval).toMatchObject({ scoreCp: 234, normalized: true });
        expect(node?.multiPvEvals).toBeUndefined();
        expect(result.current.kifMoves[0]).toMatchObject({
            elapsedMs: 1200,
            evalCp: 234,
        });
    });

    it("updateMoveEvalAtPly は手数なし詰みの ±Infinity を先手視点のまま保持する", () => {
        const { result } = setup();

        act(() => {
            result.current.addMove("7g7f", createInitialPositionState());
            result.current.addMove("3c3d", createInitialPositionState());
        });

        act(() => {
            result.current.updateMoveEvalAtPly(
                1,
                { scoreMate: Number.POSITIVE_INFINITY },
                {
                    usiMove: "7g7f",
                },
            );
            result.current.updateMoveEvalAtPly(
                2,
                { scoreMate: Number.NEGATIVE_INFINITY },
                {
                    usiMove: "3c3d",
                },
            );
        });

        expect(result.current.kifMoves[0]?.evalMate).toBe(Number.POSITIVE_INFINITY);
        expect(result.current.kifMoves[1]?.evalMate).toBe(Number.NEGATIVE_INFINITY);
        expect(result.current.evalHistory[1]?.evalMate).toBe(Number.POSITIVE_INFINITY);
        expect(result.current.evalHistory[2]?.evalMate).toBe(Number.NEGATIVE_INFINITY);
    });

    it("updateMoveEvalAtPly は分岐上の現在位置を動かさず、本譜の同一手だけを更新する", () => {
        const { result } = setup();

        act(() => {
            result.current.addMove("7g7f", createInitialPositionState());
            result.current.goBack();
            result.current.addMove("2g2f", createInitialPositionState());
        });
        const branchNodeId = result.current.tree.currentNodeId;

        act(() => {
            result.current.updateMoveEvalAtPly(1, { scoreCp: 345 }, { usiMove: "7g7f" });
        });

        expect(result.current.tree.currentNodeId).toBe(branchNodeId);
        const mainNode = [...result.current.tree.nodes.values()].find(
            (node) => node.usiMove === "7g7f",
        );
        const branchNode = result.current.tree.nodes.get(branchNodeId);
        expect(mainNode?.eval).toMatchObject({ scoreCp: 345, normalized: true });
        expect(branchNode?.eval).toBeUndefined();
    });

    it("updateMoveEvalAtPly は USI 手が一致しない場合に更新しない", () => {
        const { result } = setup();

        act(() => {
            result.current.addMove("7g7f", createInitialPositionState());
        });

        act(() => {
            result.current.updateMoveEvalAtPly(1, { scoreCp: 999 }, { usiMove: "2g2f" });
        });

        const node = [...result.current.tree.nodes.values()].find((n) => n.ply === 1);
        expect(node?.eval).toBeUndefined();
    });

    it("updateMoveEvalAtPly は既存のより深い自前解析をコメントで上書きしない", () => {
        const { result } = setup();

        act(() => {
            result.current.addMove("7g7f", createInitialPositionState());
        });

        act(() => {
            result.current.recordEvalByPly(1, {
                type: "info",
                scoreCp: 900,
                depth: 20,
                pv: ["3c3d"],
                multipv: 1,
                normalized: true,
            });
        });

        act(() => {
            result.current.updateMoveEvalAtPly(
                1,
                {
                    scoreCp: 100,
                    depth: 10,
                },
                { usiMove: "7g7f" },
            );
        });

        const node = [...result.current.tree.nodes.values()].find((n) => n.ply === 1);
        expect(node?.eval).toMatchObject({
            scoreCp: 900,
            depth: 20,
            pv: ["3c3d"],
            normalized: true,
        });
    });
});
