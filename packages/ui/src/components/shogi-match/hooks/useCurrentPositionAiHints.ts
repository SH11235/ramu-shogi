import { getCurrentNode, type KifuEval } from "@shogi/app-core";
import type { AiHintMove, AiHintSummary } from "../components/AiHintPanel";
import { summarizeAiHintEval } from "../components/AiHintPanel";
import { useAnalysis } from "../contexts/AnalysisContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { normalizeEvalToSentePerspective } from "../utils/branchTreeUtils";
import { formatEval, formatMoveSimple, mateScoreSide } from "../utils/kifFormat";

interface CurrentPositionAiHintsResult {
    moves: AiHintMove[];
    summary: AiHintSummary | null;
    isAnalyzing: boolean;
    canAnalyze: boolean;
    analyzeHint: string;
    handleAnalyze: () => void;
    handleApplyMove?: (usiMove: string) => Promise<boolean>;
}

function toScoreTone(evalData: { evalCp?: number; evalMate?: number }): AiHintMove["scoreTone"] {
    if (evalData.evalMate !== undefined && evalData.evalMate !== null) {
        return mateScoreSide(evalData.evalMate);
    }
    if (evalData.evalCp !== undefined && evalData.evalCp !== null) {
        if (evalData.evalCp > 0) return "sente";
        if (evalData.evalCp < 0) return "gote";
    }
    return "neutral";
}

function pickHintEvals(node: ReturnType<typeof getCurrentNode>): KifuEval[] {
    const multiPv = (node.multiPvEvals ?? []).filter((evalData): evalData is KifuEval =>
        Boolean(evalData?.pv?.length),
    );
    if (multiPv.length > 0) return multiPv;
    if (node.eval?.pv && node.eval.pv.length > 0) return [node.eval];
    return [];
}

/** `maxMoves` は並べる候補の上限（省略時は解析設定の MultiPV）。 */
export function useCurrentPositionAiHints(options?: {
    maxMoves?: number;
}): CurrentPositionAiHintsResult {
    const { analysisSettings, isAnalyzing, handleAnalyzeHintPly } = useAnalysis();
    const { kifuTree, navigationState } = useNavigation();
    const { position, gameMode, isPaused, sides, applyUsiMove } = useMatchState();

    const currentNode = kifuTree ? getCurrentNode(kifuTree) : null;
    const hintEvals = currentNode ? pickHintEvals(currentNode) : [];
    const ply = currentNode?.ply ?? 0;
    const hintMoves = hintEvals
        .slice(0, Math.max(1, options?.maxMoves ?? analysisSettings.multiPv))
        .map((evalData) => {
            const normalized = normalizeEvalToSentePerspective(
                evalData,
                ply,
                currentNode?.positionAfter.turn,
            );
            const usi = evalData.pv?.[0] ?? "";
            return {
                usi,
                pv: evalData.pv,
                depth: evalData.depth ?? undefined,
                displayText: usi ? formatMoveSimple(usi, position.turn, position.board) : "",
                scoreText: formatEval(normalized.evalCp, normalized.evalMate, ply),
                scoreTone: toScoreTone(normalized),
                evalCp: normalized.evalCp ?? undefined,
                evalMate: normalized.evalMate ?? undefined,
            };
        })
        .filter((move) => move.usi !== "");

    const isReviewMode = gameMode === "reviewing";
    const isHumanTurn = sides[position.turn].role === "human";
    const canAnalyze =
        !isAnalyzing && !isPaused && (isReviewMode || (gameMode === "playing" && isHumanTurn));
    const canApplyMove = isReviewMode || (gameMode === "playing" && isHumanTurn && !isPaused);

    const bestHint = hintMoves[0];
    const summary = bestHint ? summarizeAiHintEval(bestHint.evalCp, bestHint.evalMate) : null;

    return {
        moves: hintMoves,
        summary,
        isAnalyzing,
        canAnalyze,
        analyzeHint: "「解析する」を押すと現在の局面の候補手を表示します",
        handleAnalyze: () => {
            void handleAnalyzeHintPly(navigationState.currentPly);
        },
        handleApplyMove: canApplyMove ? (usiMove: string) => applyUsiMove(usiMove) : undefined,
    };
}
