import type { ReactElement } from "react";
import { FloatingWindow } from "../../floating-window";
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

/**
 * 評価値グラフを拡大表示するドラッグ可能ウィンドウ
 */
export function EvalGraphModal({
    evalHistory,
    currentPly,
    open,
    onClose,
}: EvalGraphModalProps): ReactElement | null {
    return (
        <FloatingWindow
            title="評価値推移"
            onClose={onClose}
            open={open}
            initialPosition={{
                x: typeof window !== "undefined" ? window.innerWidth / 2 - 300 : 100,
                y: typeof window !== "undefined" ? window.innerHeight / 2 - 200 : 100,
            }}
            initialSize={{ width: 600, height: 400 }}
            minWidth={MIN_WIDTH}
            minHeight={MIN_HEIGHT}
            bodyClassName="p-3 pb-2 overflow-visible"
        >
            {(size) => (
                <EvalGraph
                    evalHistory={evalHistory}
                    currentPly={currentPly}
                    height={Math.max(
                        size.height - HEADER_HEIGHT - CONTENT_PADDING - X_AXIS_LABEL_HEIGHT,
                        100,
                    )}
                    compact
                />
            )}
        </FloatingWindow>
    );
}
