import type { NnueSelection } from "@shogi/app-core";
import type { ReactElement } from "react";
import { useNnueContextOptional } from "../../../providers/NnueContext";

export interface AiHintMove {
    usi: string;
    displayText: string;
    scoreText: string;
    scoreTone: "sente" | "gote" | "neutral";
}

export interface AiHintSummary {
    percent: number;
    senteLabel: string;
    goteLabel: string;
}

interface AiHintPanelProps {
    title?: string;
    remainingLabel?: string | null;
    isAnalyzing: boolean;
    moves: AiHintMove[];
    canAnalyze: boolean;
    analyzeHint: string;
    analyzeButtonLabel?: string;
    summary?: AiHintSummary | null;
    nnueSelection: NnueSelection;
    onNnueSelectionChange: (selection: NnueSelection) => void;
    onOpenNnueManager: () => void;
    onAnalyze?: () => void;
    onApplyMove?: (usiMove: string) => void | Promise<void>;
}

function getScoreClassName(tone: AiHintMove["scoreTone"]): string {
    if (tone === "sente") return "text-wafuu-shu";
    if (tone === "gote") return "text-wafuu-ai";
    return "text-muted-foreground";
}

export function AiHintPanel({
    title = "AI ヒント",
    remainingLabel = null,
    isAnalyzing,
    moves,
    canAnalyze,
    analyzeHint,
    analyzeButtonLabel = "解析する",
    summary = null,
    nnueSelection,
    onNnueSelectionChange,
    onOpenNnueManager,
    onAnalyze,
    onApplyMove,
}: AiHintPanelProps): ReactElement {
    const nnueCtx = useNnueContextOptional();
    const nnueList = nnueCtx?.nnueList ?? [];

    return (
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-semibold text-foreground">{title}</span>
                {remainingLabel && (
                    <span className="text-xs text-muted-foreground">{remainingLabel}</span>
                )}
            </div>

            <div className="flex flex-col gap-2 px-3 py-2">
                <div className="flex items-center gap-1.5">
                    <select
                        value={nnueSelection.nnueId ?? ""}
                        onChange={(event) =>
                            onNnueSelectionChange({
                                presetKey: null,
                                nnueId: event.target.value || null,
                            })
                        }
                        className="flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                        <option value="">駒得（NNUE なし）</option>
                        {nnueList.map((nnue) => (
                            <option key={nnue.id} value={nnue.id}>
                                {nnue.displayName}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={onOpenNnueManager}
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    >
                        管理
                    </button>
                </div>

                {summary && moves.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <div className="relative h-3 w-full overflow-hidden rounded-full bg-wafuu-ai">
                            <div
                                className="absolute inset-y-0 left-0 bg-wafuu-shu transition-all duration-300"
                                style={{ width: `${summary.percent}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span className="text-wafuu-shu">{summary.senteLabel}</span>
                            <span className="text-wafuu-ai">{summary.goteLabel}</span>
                        </div>
                    </div>
                )}

                {moves.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                        {moves.map((move, index) => (
                            <div key={move.usi} className="flex items-center gap-2 text-xs">
                                <span className="w-4 text-muted-foreground">{index + 1}.</span>
                                <span className="flex-1 text-foreground">{move.displayText}</span>
                                <span className={getScoreClassName(move.scoreTone)}>
                                    {move.scoreText}
                                </span>
                                {index === 0 && onApplyMove && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void onApplyMove(move.usi);
                                        }}
                                        className="rounded bg-wafuu-shu px-1.5 py-0.5 text-xs text-wafuu-shu-fg hover:bg-wafuu-shu-light"
                                    >
                                        指す
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {isAnalyzing && moves.length === 0 && (
                    <p className="text-xs text-muted-foreground">解析中...</p>
                )}

                {!isAnalyzing && moves.length === 0 && (
                    <p className="py-1 text-center text-xs leading-relaxed text-muted-foreground">
                        {analyzeHint}
                    </p>
                )}

                {onAnalyze && (
                    <button
                        type="button"
                        onClick={onAnalyze}
                        disabled={!canAnalyze}
                        className="w-full rounded-md bg-primary py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                    >
                        {isAnalyzing ? "解析中..." : analyzeButtonLabel}
                    </button>
                )}
            </div>
        </div>
    );
}
