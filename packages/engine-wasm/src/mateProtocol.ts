import type { MateOutcome, MateParams, MateProgress } from "@shogi/engine-client";
export type MateCommand = { type: "solveMate"; requestId: string; params: MateParams };
export type MateMessage =
    | { type: "mateProgress"; requestId: string; progress: MateProgress }
    | { type: "mateFinished"; requestId: string; outcome: MateOutcome }
    | { type: "mateError"; requestId: string; message: string };
