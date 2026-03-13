import { getCurrentNode, type KifuEval } from "@shogi/app-core";
import { formatEval, formatMoveSimple } from "../utils/kifFormat";
import { normalizeEvalToSentePerspective } from "../utils/branchTreeUtils";
import { useAnalysis } from "../contexts/AnalysisContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import type { AiHintMove, AiHintSummary } from "../components/AiHintPanel";

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
        if (evalData.evalMate > 0) return "sente";
        if (evalData.evalMate < 0) return "gote";
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

export function useCurrentPositionAiHints(): CurrentPositionAiHintsResult {
    const { analysisSettings, isAnalyzing, handleAnalyzeHintPly } = useAnalysis();
    const { kifuTree, navigationState } = useNavigation();
    const { position, gameMode, isPaused, sides, applyUsiMove } = useMatchState();

    const currentNode = kifuTree ? getCurrentNode(kifuTree) : null;
    const hintEvals = currentNode ? pickHintEvals(currentNode) : [];
    const hintMoves = hintEvals
        .slice(0, Math.max(1, analysisSettings.multiPv))
        .map((evalData) => {
            const normalized = normalizeEvalToSentePerspective(evalData, currentNode!.ply);
            const usi = evalData.pv?.[0] ?? "";
            return {
                usi,
                displayText: usi ? formatMoveSimple(usi, position.turn, position.board) : "",
                scoreText: formatEval(normalized.evalCp, normalized.evalMate, currentNode!.ply),
                scoreTone: toScoreTone(normalized),
            };
        })
        .filter((move) => move.usi !== "");

    const isReviewMode = gameMode === "reviewing";
    const isHumanTurn = sides[position.turn].role === "human";
    const canAnalyze =
        !isAnalyzing && !isPaused && (isReviewMode || (gameMode === "playing" && isHumanTurn));
    const canApplyMove = isReviewMode || (gameMode === "playing" && isHumanTurn && !isPaused);

    const summary: AiHintSummary | null =
        currentNode && hintMoves.length > 0
            ? (() => {
                  const bestEvalSource = hintEvals[0] ?? currentNode.eval ?? undefined;
                  const bestEval = bestEvalSource
                      ? normalizeEvalToSentePerspective(bestEvalSource, currentNode.ply)
                      : undefined;
                  const evalCp = bestEval?.evalCp ?? null;
                  const evalMate = bestEval?.evalMate ?? null;
                  const percent =
                      evalMate !== null && evalMate !== undefined
                          ? evalMate > 0
                              ? 100
                              : 0
                          : evalCp !== null
                            ? Math.min(100, Math.max(0, 50 + (evalCp / 2000) * 50))
                            : 50;
                  return {
                      percent,
                      senteLabel:
                          evalMate !== null
                              ? evalMate > 0
                                  ? `▲ +詰${evalMate}`
                                  : "▲"
                              : evalCp !== null && evalCp > 0
                                ? `▲ ${formatEval(evalCp)}`
                                : "▲",
                      goteLabel:
                          evalMate !== null
                              ? evalMate < 0
                                  ? `△ +詰${Math.abs(evalMate)}`
                                  : "△"
                              : evalCp !== null && evalCp < 0
                                ? `△ ${formatEval(Math.abs(evalCp))}`
                                : "△",
                  };
              })()
            : null;

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
