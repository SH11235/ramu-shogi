import type { BoardState, NnueSelection } from "@shogi/app-core";
import type { AiSupportSettings, Seat } from "@shogi/match-client";
import type { ReactElement } from "react";
import {
    type AiHintMove,
    AiHintPanel,
    summarizeAiHintEval,
} from "../shogi-match/components/AiHintPanel";
import { formatEval, formatMoveSimple, mateScoreSide } from "../shogi-match/utils/kifFormat";
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

    const firstMove = topMoves[0];
    const canClickAnalyze = canAnalyze && !isAnalyzing && !hasNoRemaining;
    const moves: AiHintMove[] = topMoves.slice(0, 3).map((mv) => {
        const cp = mv.cp ?? 0;
        return {
            usi: mv.usi,
            displayText: analysisBoard
                ? formatMoveSimple(mv.usi, analysisTurn === "b" ? "sente" : "gote", analysisBoard)
                : mv.usi,
            scoreText: formatEval(mv.cp, mv.mate),
            scoreTone:
                mv.mate != null
                    ? mateScoreSide(mv.mate)
                    : cp > 0
                      ? "sente"
                      : cp < 0
                        ? "gote"
                        : "neutral",
            pv: mv.pv,
            evalCp: mv.cp,
            evalMate: mv.mate,
        };
    });

    return (
        <AiHintPanel
            title="AI 解析"
            remainingLabel={isLimited ? `残り ${myAnalysisRemaining ?? 0} 回` : null}
            isAnalyzing={isAnalyzing}
            moves={moves}
            canAnalyze={canClickAnalyze}
            analyzeHint={analyzeHint}
            summary={summarizeAiHintEval(firstMove?.cp, firstMove?.mate)}
            nnueSelection={nnueSelection}
            onNnueSelectionChange={onNnueSelectionChange}
            onOpenNnueManager={onOpenNnueManager}
            onAnalyze={onAnalyze}
            onApplyMove={onApplyMove}
            onPreviewPv={onPreviewPv}
        />
    );
}
