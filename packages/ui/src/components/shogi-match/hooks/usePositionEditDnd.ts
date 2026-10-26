import type { PieceType, Player, PositionState, Square } from "@shogi/app-core";
import { applyDropResult } from "../dnd/dropLogic";
import type { DropResult } from "../dnd/types";
import { usePieceDnd } from "../dnd/usePieceDnd";
import type { Message } from "../types";

type BoardPiece = { owner: "sente" | "gote"; type: string; promoted?: boolean };

/** 局面編集で、駒をドラッグして置く・駒台から足す・成り不成を切り替える操作。 */
export function usePositionEditDnd({
    editAllowed,
    position,
    positionRef,
    setMessage,
    applyEditedPosition,
    setPiecePromotion,
}: {
    editAllowed: boolean;
    position: PositionState;
    positionRef: { current: PositionState };
    setMessage: (message: Message | null) => void;
    applyEditedPosition: (next: PositionState) => void;
    setPiecePromotion: (square: Square, promoted: boolean) => void;
}) {
    const handleDndDrop = (result: DropResult) => {
        if (!editAllowed) return;

        const applied = applyDropResult(result, positionRef.current);
        if (!applied.ok) {
            setMessage({ text: applied.error ?? "ドロップに失敗しました", type: "error" });
            return;
        }

        applyEditedPosition(applied.next);
    };

    const dndController = usePieceDnd({
        onDrop: handleDndDrop,
        disabled: !editAllowed,
    });

    // 編集できるかは usePieceDnd の disabled と、呼び出し側が props を渡すかどうかで決まるので、ここでは見ない。
    const handlePiecePointerDown = (square: string, piece: BoardPiece, e: React.PointerEvent) => {
        const origin = { type: "board" as const, square: square as Square };
        const payload = {
            owner: piece.owner as Player,
            pieceType: piece.type as PieceType,
            isPromoted: piece.promoted ?? false,
        };

        dndController.startDrag(origin, payload, e);
    };

    const handleHandPiecePointerDown = (
        owner: Player,
        pieceType: PieceType,
        e: React.PointerEvent,
    ) => {
        // 持ち駒が0個の場合はストック扱い（編集モード時、無限供給）
        const count = position?.hands[owner][pieceType] ?? 0;
        const origin =
            count > 0
                ? { type: "hand" as const, owner, pieceType }
                : { type: "stock" as const, owner, pieceType };
        const payload = {
            owner,
            pieceType,
            isPromoted: false,
        };

        dndController.startDrag(origin, payload, e);
    };

    const handlePieceTogglePromote = (
        square: string,
        piece: BoardPiece,
        _event: React.MouseEvent<HTMLButtonElement>,
    ) => {
        if (!editAllowed) return;
        setPiecePromotion(square as Square, !piece.promoted);
    };

    return {
        dndController,
        handlePiecePointerDown,
        handleHandPiecePointerDown,
        handlePieceTogglePromote,
    };
}
