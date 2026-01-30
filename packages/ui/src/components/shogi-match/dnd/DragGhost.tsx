/**
 * ドラッグ中のゴースト駒コンポーネント
 *
 * Portal で document.body に描画し、transform で高速移動
 * pointer-events: none でクリックを透過
 */

import { cn } from "@shogi/design-system";
import { forwardRef } from "react";
import { createPortal } from "react-dom";
import { PIECE_LABELS, getPieceImagePath } from "../utils/constants";
import type { DndState } from "./types";

interface DragGhostProps {
    /** DnD 状態 */
    dndState: DndState;
    /** オーナーの向き */
    ownerOrientation?: "sente" | "gote";
}

/**
 * ゴースト駒コンポーネント
 *
 * 和風デザインで、ドラッグ中の駒を表現
 * - 木目調の背景
 * - ドロップシャドウで浮遊感
 * - 削除モード時は赤いオーラ
 */
export const DragGhost = forwardRef<HTMLDivElement, DragGhostProps>(function DragGhost(
    { dndState, ownerOrientation = "sente" },
    ref,
) {
    const { isDragging, payload, mode } = dndState;

    if (typeof document === "undefined") {
        return null;
    }

    const shouldFlip =
        ownerOrientation === "sente" ? payload?.owner === "gote" : payload?.owner === "sente";

    return createPortal(
        <div
            ref={ref}
            className={cn(
                "pointer-events-none fixed left-0 top-0 z-[9999]",
                "h-12 w-12 items-center justify-center transition-opacity duration-75 will-change-transform",
                isDragging ? "flex opacity-100" : "hidden opacity-0",
            )}
            aria-hidden="true"
        >
            {/* 駒本体 */}
            <div
                className={cn(
                    "relative flex h-11 w-11 items-center justify-center",
                    "shadow-[0_8px_24px_rgba(0,0,0,0.35),0_4px_8px_rgba(0,0,0,0.2)]",
                    "transform-gpu",
                    shouldFlip && "-rotate-180",
                    // 削除モード時のエフェクト
                    mode === "delete" && [
                        "ring-2 ring-red-500/70",
                        "shadow-[0_0_16px_rgba(239,68,68,0.5),0_8px_24px_rgba(0,0,0,0.35)]",
                    ],
                )}
            >
                {/* 駒画像 */}
                {payload && (
                    <img
                        src={getPieceImagePath(
                            payload.owner,
                            payload.pieceType,
                            payload.isPromoted,
                        )}
                        alt={`${payload.owner === "sente" ? "先手" : "後手"}の${PIECE_LABELS[payload.pieceType]}${payload.isPromoted ? "成" : ""}`}
                        className="h-full w-full object-contain"
                        draggable={false}
                    />
                )}
            </div>

            {/* ドラッグ中のパルスエフェクト */}
            <div
                className={cn(
                    "absolute inset-0 rounded-lg",
                    "animate-[ping_1.5s_infinite]",
                    mode === "delete" ? "bg-red-400/20" : "bg-amber-400/20",
                    "pointer-events-none",
                )}
            />
        </div>,
        document.body,
    );
});
