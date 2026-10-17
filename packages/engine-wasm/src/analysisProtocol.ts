import type { AnalysisBudget, AnalysisFinished, EngineInfoEvent } from "@shogi/engine-client";
export type AnalysisCommand =
    | {
          type: "prepareAnalysis";
          requestId: string;
          sessionId: string;
          resume: boolean;
          budget: AnalysisBudget;
      }
    | { type: "runAnalysis"; sessionId: string; runId: number }
    | { type: "releaseAnalysis"; requestId: string };
export type AnalysisMessage =
    | {
          type: "analysisPrepared";
          requestId: string;
          sessionId: string;
          runId: number;
          address: number;
          buffer: SharedArrayBuffer;
      }
    | { type: "analysisInfo"; sessionId: string; runId: number; info: EngineInfoEvent }
    | { type: "analysisFinished"; result: AnalysisFinished }
    | { type: "analysisError"; requestId?: string; message: string };
