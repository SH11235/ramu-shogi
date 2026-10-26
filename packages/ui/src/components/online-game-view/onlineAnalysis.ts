import type { LayerStacksConfig } from "@shogi/app-core";

export interface AnalysisMoveResult {
    usi: string;
    cp: number;
    pv: string[];
}

export interface OnlineAnalysis {
    isAnalyzing: boolean;
    topMoves: AnalysisMoveResult[];
    startAnalysis: (sfen: string, moves: string[]) => Promise<void>;
    cancelAnalysis: () => Promise<void>;
    loadNnue?: (nnueId: string | null, layerStacks?: LayerStacksConfig) => Promise<void>;
}
