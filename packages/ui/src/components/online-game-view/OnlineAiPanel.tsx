import type { BoardState, NnueSelection } from "@shogi/app-core";
import type { AiSupportSettings, Seat } from "@shogi/match-client";
import type { ReactElement } from "react";
import { type AiHintMove, AiHintPanel } from "../shogi-match/components/AiHintPanel";
import { formatMoveSimple } from "../shogi-match/utils/kifFormat";
import type { AnalysisMoveResult } from "./onlineAnalysis";

interface OnlineAiPanelProps {
    aiSupport?: AiSupportSettings;
    seat: Seat;
    myAnalysisRemaining: number | null;
    isAnalyzing: boolean;
    topMoves: AnalysisMoveResult[];
    canAnalyze: boolean;
    analyzeHint: string;
    onAnalyze: () => void;
    analysisBoard: BoardState | null;
    analysisTurn: "b" | "w";
    nnueSelection: NnueSelection;
    onNnueSelectionChange: (sel: NnueSelection) => void;
    onOpenNnueManager: () => void;
    onApplyMove?: (usiMove: string) => Promise<unknown>;
    onPreviewPv?: (move: AiHintMove) => void;
}

export function OnlineAiPanel({
    aiSupport,
    seat,
    myAnalysisRemaining,
    isAnalyzing,
    topMoves,
    canAnalyze,
    analyzeHint,
    onAnalyze,
    analysisBoard,
    analysisTurn,
    nnueSelection,
    onNnueSelectionChange,
    onOpenNnueManager,
    onApplyMove,
    onPreviewPv,
}: OnlineAiPanelProps): ReactElement {
    const mySeatKey = seat === "b" ? "b" : seat === "w" ? "w" : null;
    const myMode = mySeatKey && aiSupport ? aiSupport[mySeatKey].mode : null;
    const isLimited = myMode === "limited";
    const hasNoRemaining = isLimited && myAnalysisRemaining !== null && myAnalysisRemaining <= 0;

    const evalCp = topMoves[0]?.cp ?? null;
    const evalPercent =
        evalCp !== null ? Math.min(100, Math.max(0, 50 + (evalCp / 2000) * 50)) : 50;
    const canClickAnalyze = canAnalyze && !isAnalyzing && !hasNoRemaining;
    const moves: AiHintMove[] = topMoves.slice(0, 3).map((mv) => ({
        usi: mv.usi,
        displayText: analysisBoard
            ? formatMoveSimple(mv.usi, analysisTurn === "b" ? "sente" : "gote", analysisBoard)
            : mv.usi,
        scoreText: `${mv.cp > 0 ? "+" : ""}${mv.cp}`,
        scoreTone: mv.cp > 0 ? "sente" : mv.cp < 0 ? "gote" : "neutral",
        pv: mv.pv,
        evalCp: mv.cp,
    }));

    return (
        <AiHintPanel
            title="AI 解析"
            remainingLabel={isLimited ? `残り ${myAnalysisRemaining ?? 0} 回` : null}
            isAnalyzing={isAnalyzing}
            moves={moves}
            canAnalyze={canClickAnalyze}
            analyzeHint={analyzeHint}
            summary={{
                percent: evalPercent,
                senteLabel: evalCp !== null && evalCp > 0 ? `▲ +${evalCp}` : "▲",
                goteLabel: evalCp !== null && evalCp < 0 ? `△ +${Math.abs(evalCp)}` : "△",
            }}
            nnueSelection={nnueSelection}
            onNnueSelectionChange={onNnueSelectionChange}
            onOpenNnueManager={onOpenNnueManager}
            onAnalyze={onAnalyze}
            onApplyMove={onApplyMove}
            onPreviewPv={onPreviewPv}
        />
    );
}
