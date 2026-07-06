/**
 * 評価値パネル（折りたたみ可能）
 *
 * 評価値グラフを表示
 * 対局中のチート防止のためデフォルトで折りたたまれている
 */

import type { ReactElement } from "react";
import { useState } from "react";
import type { EvalHistory } from "../utils/kifFormat";
import { EvalGraph } from "./EvalGraph";
import { EvalGraphModal } from "./EvalGraphModal";
import { EvalScoreboard } from "./EvalScoreboard";

interface EvalPanelProps {
    /** 評価値の履歴（グラフ用） */
    evalHistory: EvalHistory[];
    /** 現在の手数 */
    currentPly: number;
    /** 手数クリック時のコールバック */
    onPlySelect?: (ply: number) => void;
    /** デフォルトで開いているか */
    initialOpen?: boolean;
    /** 検討/観戦モードか。true なら評価値スコアボード(計器)をヘッダー直下に
        常時表示する。対局ページでは出さない(チート防止、グラフ既定閉と同方針) */
    reviewMode?: boolean;
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
    reviewMode = false,
}: EvalPanelProps): ReactElement {
    const [isOpen, setIsOpen] = useState(initialOpen);
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
            <button
                type="button"
                className={`flex justify-between items-center px-3 py-2.5 cursor-pointer select-none w-full bg-transparent border-0 text-left font-[inherit] text-[inherit] ${
                    isOpen && !reviewMode ? "border-b border-border" : ""
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
                <span
                    className={`text-xs text-muted-foreground transition-transform duration-200 ${
                        isOpen ? "rotate-180" : "rotate-0"
                    }`}
                >
                    ▼
                </span>
            </button>

            {/* 評価値スコアボード(計器)。検討/観戦のみ、折りたたみ状態でも常時表示。
                ヘッダーの border-b はスコアボード表示時こちらに移す */}
            {reviewMode && (
                <div
                    className={`px-3 pb-2.5 ${isOpen ? "border-b border-border" : ""}`}
                    data-testid="eval-scoreboard"
                >
                    {/* evalHistory は手数 index の配列 (MobileLayout 等と同じアクセス規約) */}
                    <EvalScoreboard entry={evalHistory[currentPly]} />
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
