import { createInitialPositionState, type PositionState } from "@shogi/app-core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditModeActions } from "./useEditModeActions";
import type { UseKifuNavigationResult } from "./useKifuNavigation";

type Props = Parameters<typeof useEditModeActions>[0];

function setup(options?: {
    position?: PositionState;
    refreshStartSfen?: Props["refreshStartSfen"];
}) {
    const position = options?.position ?? createInitialPositionState();
    const positionRef = { current: position };
    const navigation = { reset: vi.fn() } as unknown as UseKifuNavigationResult;
    const props: Props = {
        position,
        positionRef,
        editVersionRef: { current: 0 },
        navigation,
        isEditMode: true,
        isMatchRunning: false,
        matchEndedRef: { current: false },
        clearLegalCache: vi.fn(),
        stopTicking: vi.fn(),
        refreshStartSfen: options?.refreshStartSfen ?? vi.fn().mockResolvedValue("sfen"),
        setPosition: vi.fn(),
        setInitialBoard: vi.fn(),
        setLastMove: vi.fn(),
        setSelection: vi.fn(),
        setMessage: vi.fn(),
        setLastAddedBranchInfo: vi.fn(),
        setEditFromSquare: vi.fn(),
        setIsMatchRunning: vi.fn(),
    };
    const { result } = renderHook(() => useEditModeActions(props));
    return { result, props, position, positionRef, navigation };
}

describe("useEditModeActions", () => {
    describe("applyEditedPosition", () => {
        // 持ち主ごとに数えると通ってしまう「3 枚目の角」。エンジン側は合計で数えるので
        // SFEN 変換に失敗し、盤だけ書き換わって「局面の適用に失敗しました。」が出ていた。
        it("駒の枚数が一組を超える局面は、盤へ反映する前に弾いて理由を表示する", async () => {
            const { result, props, position, positionRef } = setup();
            const next: PositionState = {
                ...position,
                board: { ...position.board, "5e": { owner: "sente", type: "B" } },
            };

            await act(async () => {
                await result.current.applyEditedPosition(next);
            });

            expect(props.setPosition).not.toHaveBeenCalled();
            expect(props.setInitialBoard).not.toHaveBeenCalled();
            expect(props.refreshStartSfen).not.toHaveBeenCalled();
            expect(positionRef.current).toBe(position);
            expect(props.setMessage).toHaveBeenCalledWith({
                text: "角は先手・後手あわせて最大2枚までです。",
                type: "warning",
            });
        });

        it("成り立つ局面は反映し、エラーを出さない", async () => {
            const { result, props, position, positionRef, navigation } = setup();
            const next: PositionState = {
                ...position,
                board: {
                    ...position.board,
                    "7g": null,
                    "7f": { owner: "sente", type: "P" },
                },
            };

            await act(async () => {
                await result.current.applyEditedPosition(next);
            });

            expect(props.setPosition).toHaveBeenCalledWith(next);
            expect(positionRef.current).toBe(next);
            expect(navigation.reset).toHaveBeenCalledWith(next, "sfen");
            expect(props.setMessage).toHaveBeenCalledTimes(1);
            expect(props.setMessage).toHaveBeenCalledWith(null);
        });

        it("SFEN 変換に失敗したら元の局面へ戻し、理由つきのメッセージを出す", async () => {
            const refreshStartSfen = vi.fn().mockRejectedValue("Invalid board: something");
            const { result, props, position, positionRef, navigation } = setup({
                refreshStartSfen,
            });
            const next: PositionState = {
                ...position,
                board: {
                    ...position.board,
                    "7g": null,
                    "7f": { owner: "sente", type: "P" },
                },
            };

            await act(async () => {
                await result.current.applyEditedPosition(next);
            });

            expect(props.setPosition).toHaveBeenNthCalledWith(1, next);
            expect(props.setPosition).toHaveBeenLastCalledWith(position);
            expect(positionRef.current).toBe(position);
            expect(props.setInitialBoard).toHaveBeenLastCalledWith(position.board);
            expect(navigation.reset).not.toHaveBeenCalled();
            expect(props.setMessage).toHaveBeenLastCalledWith({
                text: "局面を適用できなかったため、元に戻しました: Invalid board: something",
                type: "error",
            });
        });

        it("変換待ちの間に重ねた編集も失敗したら、変換を通った最後の局面まで戻す", async () => {
            const rejecters: Array<(reason: unknown) => void> = [];
            const refreshStartSfen = vi.fn(
                () =>
                    new Promise<string>((_resolve, reject) => {
                        rejecters.push(reject);
                    }),
            );
            const { result, props, position, positionRef } = setup({ refreshStartSfen });
            const first: PositionState = {
                ...position,
                board: { ...position.board, "7g": null, "7f": { owner: "sente", type: "P" } },
            };
            const second: PositionState = {
                ...first,
                board: { ...first.board, "2g": null, "2f": { owner: "sente", type: "P" } },
            };

            await act(async () => {
                const p1 = result.current.applyEditedPosition(first);
                const p2 = result.current.applyEditedPosition(second);
                rejecters[0]("first failed");
                rejecters[1]("second failed");
                await Promise.all([p1, p2]);
            });

            expect(props.setPosition).toHaveBeenLastCalledWith(position);
            expect(positionRef.current).toBe(position);
        });
    });

    describe("placePieceAt", () => {
        it("平手の初期局面に3枚目の角は置けない（盤は変えずに理由を表示する）", () => {
            const { result, props, position, positionRef } = setup();

            let placed = true;
            act(() => {
                placed = result.current.placePieceAt("5e", { owner: "sente", type: "B" });
            });

            expect(placed).toBe(false);
            expect(props.setPosition).not.toHaveBeenCalled();
            expect(positionRef.current).toBe(position);
            expect(props.setMessage).toHaveBeenCalledWith({
                text: "角は先手・後手あわせて最大2枚までです。",
                type: "warning",
            });
        });

        it("後手の駒でも同じく弾く", () => {
            const { result, props } = setup();

            let placed = true;
            act(() => {
                placed = result.current.placePieceAt("5e", { owner: "gote", type: "P" });
            });

            expect(placed).toBe(false);
            expect(props.setPosition).not.toHaveBeenCalled();
        });

        it("玉を取り除く操作は弾く", () => {
            const { result, props } = setup();

            let placed = true;
            act(() => {
                placed = result.current.placePieceAt("5i", null);
            });

            expect(placed).toBe(false);
            expect(props.setPosition).not.toHaveBeenCalled();
        });

        it("盤上の駒の移動では持ち駒を減らさない", async () => {
            const position = createInitialPositionState();
            position.board["2b"] = null;
            position.hands.sente.B = 1;
            const { result, props } = setup({ position });

            await act(async () => {
                result.current.placePieceAt(
                    "5e",
                    { owner: "sente", type: "B" },
                    { fromSquare: "8h" },
                );
            });

            const applied = vi.mocked(props.setPosition).mock.calls[0][0];
            expect(applied.board["8h"]).toBeNull();
            expect(applied.board["5e"]).toEqual({ owner: "sente", type: "B" });
            expect(applied.hands.sente.B).toBe(1);
        });
    });

    describe("handleIncrementHand", () => {
        it("先手・後手を合わせて一組の枚数に達している駒は増やせない", () => {
            const { result, props } = setup();

            act(() => {
                result.current.handleIncrementHand("sente", "B");
            });

            expect(props.setPosition).not.toHaveBeenCalled();
            expect(props.setMessage).toHaveBeenCalledWith({
                text: "角は先手・後手あわせて最大2枚までです。",
                type: "warning",
            });
        });

        it("盤上の駒が減っていれば、そのぶんだけ増やせる", () => {
            const position = createInitialPositionState();
            position.board["2b"] = null;
            const { result, props } = setup({ position });

            act(() => {
                result.current.handleIncrementHand("sente", "B");
            });

            const applied = vi.mocked(props.setPosition).mock.calls[0][0];
            expect(applied.hands.sente.B).toBe(1);
        });
    });
});
