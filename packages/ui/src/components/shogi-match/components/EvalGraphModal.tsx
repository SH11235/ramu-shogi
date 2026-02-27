/**
 * 評価値グラフ拡大表示ウィンドウ（ドラッグ・リサイズ可能）
 *
 * 非モーダル：背景操作をブロックしない
 * 四隅＋四辺からリサイズ可能
 */

import type { ReactElement } from "react";
import { useEffect } from "react";
import { useDraggableWindow } from "../hooks/useDraggableWindow";
import type { EvalHistory } from "../utils/kifFormat";
import { EvalGraph } from "./EvalGraph";

interface EvalGraphModalProps {
    /** 評価値の履歴 */
    evalHistory: EvalHistory[];
    /** 現在の手数 */
    currentPly: number;
    /** ウィンドウの開閉状態 */
    open: boolean;
    /** 閉じる時のコールバック */
    onClose: () => void;
}

const MIN_WIDTH = 300;
const MIN_HEIGHT = 200;
const HEADER_HEIGHT = 40;
const CONTENT_PADDING = 20;
const X_AXIS_LABEL_HEIGHT = 20;
const EDGE_HANDLE_SIZE = 6;

/**
 * 評価値グラフを拡大表示するドラッグ可能ウィンドウ
 */
export function EvalGraphModal({
    evalHistory,
    currentPly,
    open,
    onClose,
}: EvalGraphModalProps): ReactElement | null {
    const { geometry, handlers } = useDraggableWindow(
        {
            x: typeof window !== "undefined" ? window.innerWidth / 2 - 300 : 100,
            y: typeof window !== "undefined" ? window.innerHeight / 2 - 200 : 100,
        },
        { width: 600, height: 400 },
        { minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT, open },
    );

    const { position, size } = geometry;
    const { onMoveStart, createResizeHandler } = handlers;

    // Escキーでウィンドウを閉じる
    useEffect(() => {
        if (!open) return;

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, [open, onClose]);

    if (!open) {
        return null;
    }

    const graphHeight = Math.max(
        size.height - HEADER_HEIGHT - CONTENT_PADDING - X_AXIS_LABEL_HEIGHT,
        100,
    );

    return (
        <div
            className="fixed flex flex-col overflow-hidden bg-card border border-border rounded-xl shadow-2xl z-[1000]"
            style={{
                left: position.x,
                top: position.y,
                width: size.width,
                height: size.height,
            }}
        >
            {/* ヘッダー（ドラッグハンドル） */}
            <div
                className="flex justify-between items-center px-3 py-2 bg-muted border-b border-border cursor-move select-none h-10 box-border"
                onMouseDown={onMoveStart}
                role="toolbar"
                aria-label="ウィンドウ移動ハンドル"
            >
                <span className="font-semibold text-sm">評価値推移</span>
                <button
                    type="button"
                    className="bg-transparent border-none cursor-pointer px-2 py-1 rounded text-base leading-none text-muted-foreground hover:bg-accent"
                    onClick={onClose}
                    aria-label="閉じる"
                >
                    ✕
                </button>
            </div>

            {/* グラフ本体 */}
            <div className="flex-1 p-3 pb-2 overflow-visible">
                <EvalGraph
                    evalHistory={evalHistory}
                    currentPly={currentPly}
                    height={graphHeight}
                    compact
                />
            </div>

            {/* リサイズハンドル - マウス操作専用のためアクセシビリティツリーから除外 */}
            <div
                className="absolute top-0 left-3 right-3 cursor-ns-resize"
                style={{ height: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-n")}
                aria-hidden="true"
            />
            <div
                className="absolute bottom-0 left-3 right-3 cursor-ns-resize"
                style={{ height: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-s")}
                aria-hidden="true"
            />
            <div
                className="absolute left-0 top-3 bottom-3 cursor-ew-resize"
                style={{ width: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-w")}
                aria-hidden="true"
            />
            <div
                className="absolute right-0 top-3 bottom-3 cursor-ew-resize"
                style={{ width: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-e")}
                aria-hidden="true"
            />
            <div
                className="absolute left-0 top-0 w-3 h-3 cursor-nwse-resize"
                onMouseDown={createResizeHandler("resize-nw")}
                aria-hidden="true"
            >
                <div className="absolute left-1 top-1 w-2 h-2 border-l-2 border-t-2 border-muted-foreground opacity-50" />
            </div>
            <div
                className="absolute right-0 top-0 w-3 h-3 cursor-nesw-resize"
                onMouseDown={createResizeHandler("resize-ne")}
                aria-hidden="true"
            >
                <div className="absolute right-1 top-1 w-2 h-2 border-r-2 border-t-2 border-muted-foreground opacity-50" />
            </div>
            <div
                className="absolute left-0 bottom-0 w-3 h-3 cursor-nesw-resize"
                onMouseDown={createResizeHandler("resize-sw")}
                aria-hidden="true"
            >
                <div className="absolute left-1 bottom-1 w-2 h-2 border-l-2 border-b-2 border-muted-foreground opacity-50" />
            </div>
            <div
                className="absolute right-0 bottom-0 w-3 h-3 cursor-nwse-resize"
                onMouseDown={createResizeHandler("resize-se")}
                aria-hidden="true"
            >
                <div className="absolute right-1 bottom-1 w-2 h-2 border-r-2 border-b-2 border-muted-foreground opacity-50" />
            </div>
        </div>
    );
}
