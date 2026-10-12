import { ChevronIcon } from "../../chevron-icon";
/**
 * 評価値パネル（折りたたみ可能）
 *
 * 評価値グラフを表示する。最初に開いておくかは呼び出し側が決める
 * （対局中はチート防止のため閉じておき、棋譜を見る・検討する画面では開いておく）。
 * 棋譜ビューアのように隠す理由の無い画面では、折りたたみの操作ごと無くせる。
 */

import type { ReactElement } from "react";
import { useState } from "react";
import type { EvalHistory } from "../utils/kifFormat";
import { EvalGraph } from "./EvalGraph";
import { EvalGraphModal } from "./EvalGraphModal";

interface EvalPanelProps {
    /** 評価値の履歴（グラフ用） */
    evalHistory: EvalHistory[];
    /** 現在の手数 */
    currentPly: number;
    /** 手数クリック時のコールバック */
    onPlySelect?: (ply: number) => void;
    /** デフォルトで開いているか */
    initialOpen?: boolean;
    /**
     * 折りたためるか（既定は true）。false にすると常に開いたままで、開閉の操作
     * （見出しのクリック、「（クリックで展開）」、シェブロン）を出さない。
     */
    collapsible?: boolean;
}

/**
 * 評価値パネル
 * 評価値グラフを折りたたみ可能な形で表示
 */
export function EvalPanel({
    evalHistory,
    currentPly,
    onPlySelect,
    initialOpen = false,
    collapsible = true,
}: EvalPanelProps): ReactElement {
    const [isOpenState, setIsOpen] = useState(initialOpen);
    const isOpen = !collapsible || isOpenState;
    const [showEvalModal, setShowEvalModal] = useState(false);

    const handleToggle = () => {
        setIsOpen(!isOpen);
    };

    const handleGraphClick = () => {
        setShowEvalModal(true);
    };

    const handleModalClose = () => {
        setShowEvalModal(false);
    };

    return (
        <div className="bg-card border border-border rounded-xl shadow-lg w-[var(--panel-width)] overflow-hidden">
            {collapsible ? (
                <button
                    type="button"
                    className={`flex justify-between items-center px-3 py-2.5 cursor-pointer select-none w-full bg-transparent border-0 text-left font-[inherit] text-[inherit] ${
                        isOpen ? "border-b border-border" : ""
                    }`}
                    onClick={handleToggle}
                    aria-expanded={isOpen}
                >
                    <div className="font-bold text-sm flex items-center gap-2">
                        <span>評価値グラフ</span>
                        {!isOpen && (
                            <span className="text-[11px] text-muted-foreground font-normal">
                                （クリックで展開）
                            </span>
                        )}
                    </div>
                    <ChevronIcon expanded={isOpen} />
                </button>
            ) : (
                <div className="border-b border-border px-3 py-2.5 text-sm font-bold">
                    評価値グラフ
                </div>
            )}

            <div
                className={`overflow-hidden transition-[grid-template-rows] duration-200 grid ${
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
            >
                <div className="min-h-0">
                    <div className="p-3">
                        {/* 評価値グラフ（クリックで拡大モーダル表示、手数選択対応） */}
                        <EvalGraph
                            evalHistory={evalHistory}
                            currentPly={currentPly}
                            compact={true}
                            height={80}
                            onClick={handleGraphClick}
                            onPlySelect={onPlySelect}
                        />
                    </div>
                </div>
            </div>

            {/* 評価値グラフ拡大モーダル */}
            <EvalGraphModal
                evalHistory={evalHistory}
                currentPly={currentPly}
                open={showEvalModal}
                onClose={handleModalClose}
            />
        </div>
    );
}
