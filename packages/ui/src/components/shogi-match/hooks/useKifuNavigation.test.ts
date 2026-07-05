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
});
