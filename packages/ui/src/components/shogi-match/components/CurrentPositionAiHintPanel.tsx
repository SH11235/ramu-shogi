import type { ReactElement } from "react";
import { useAnalysis } from "../contexts/AnalysisContext";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useCurrentPositionAiHints } from "../hooks/useCurrentPositionAiHints";
import { AiHintPanel } from "./AiHintPanel";

interface CurrentPositionAiHintPanelProps {
    title?: string;
}

export function CurrentPositionAiHintPanel({
    title = "AI ヒント",
}: CurrentPositionAiHintPanelProps): ReactElement {
    const { analysisNnueSelection, onAnalysisNnueSelectionChange } = useAnalysis();
    const { onOpenNnueManager } = useMatchSettings();
    const { moves, summary, isAnalyzing, canAnalyze, analyzeHint, handleAnalyze, handleApplyMove } =
        useCurrentPositionAiHints();

    return (
        <AiHintPanel
            title={title}
            isAnalyzing={isAnalyzing}
            moves={moves}
            canAnalyze={canAnalyze}
            analyzeHint={analyzeHint}
            summary={summary}
            nnueSelection={analysisNnueSelection}
            onNnueSelectionChange={onAnalysisNnueSelectionChange}
            onOpenNnueManager={onOpenNnueManager}
            onAnalyze={handleAnalyze}
            onApplyMove={handleApplyMove}
        />
    );
}
