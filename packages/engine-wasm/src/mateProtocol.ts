import type { MateLine, MateOutcome, MateParams, MateProgress } from "@shogi/engine-client";
export type MateCommand = { type: "solveMate"; requestId: string; params: MateParams };
export type MateMessage =
    | { type: "mateProgress"; requestId: string; progress: MateProgress }
    | { type: "mateLine"; requestId: string; line: MateLine }
    | { type: "mateFinished"; requestId: string; outcome: MateOutcome }
    | { type: "mateError"; requestId: string; message: string };
