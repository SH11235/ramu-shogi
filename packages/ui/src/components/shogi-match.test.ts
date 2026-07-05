import { applyMoveWithState, createInitialPositionState } from "@shogi/app-core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
    analysisSnapshotEntryToRecordedEvalInfoEvent,
    applyReviewMoveDataDiff,
    getInitialReviewSyncMode,
    stringifyReviewMoveData,
    useInitialReviewSync,
} from "./shogi-match";
import type { ReviewMoveEval } from "./shogi-match/hooks/useKifuImportExport";
import { useKifuNavigation } from "./shogi-match/hooks/useKifuNavigation";

describe("analysisSnapshotEntryToRecordedEvalInfoEvent", () => {
    it("initialAnalysisEntries 再適用用イベントには normalized:true を付ける", () => {
        expect(
            analysisSnapshotEntryToRecordedEvalInfoEvent({
                ply: 1,
                evalCp: 123,
                evalMate: null,
                depth: 10,
                pv: ["3c3d"],
                multiPv: null,
            }),
        ).toMatchObject({
            type: "info",
            scoreCp: 123,
            scoreMate: undefined,
            depth: 10,
            pv: ["3c3d"],
            multipv: 1,
            normalized: true,
        });
    });
});

describe("initialReview sync", () => {
    it("moveData key は NaN と ±Infinity を区別して直列化する", () => {
        expect(
            stringifyReviewMoveData([
                { evalMate: Number.POSITIVE_INFINITY },
                { evalMate: Number.NEGATIVE_INFINITY },
                { evalCp: Number.NaN },
            ]),
        ).toBe('[{"evalMate":"Infinity"},{"evalMate":"-Infinity"},{"evalCp":null}]');
    });

    it("指し手が増えた場合は import 経路、moveData のみ変わった場合は差分適用経路を選ぶ", () => {
        const loaded = {
            sfen: "startpos",
            movesKey: "7g7f",
            moveDataKey: "[null]",
        };

        expect(getInitialReviewSyncMode(loaded, loaded)).toBe("skip");
        expect(
            getInitialReviewSyncMode(loaded, {
                ...loaded,
                movesKey: "7g7f 3c3d",
            }),
        ).toBe("import");
        expect(
            getInitialReviewSyncMode(loaded, {
                ...loaded,
                moveDataKey: '[{"evalCp":100}]',
            }),
        ).toBe("diff");
    });

    it("コメント到着時は importSfen 相当を呼ばず、既存 ply へ差分適用する", () => {
        const calls: Array<{
            ply: number;
            update: { elapsedMs?: number; scoreCp?: number; scoreMate?: number };
            usiMove?: string;
        }> = [];
        const navigation = {
            updateMoveEvalAtPly: (
                ply: number,
                update: { elapsedMs?: number; scoreCp?: number; scoreMate?: number } | undefined,
                options?: { usiMove?: string },
            ): "applied" | "preserved" | "missing" => {
                if (!update) return "preserved";
                calls.push({ ply, update, usiMove: options?.usiMove });
                return "applied";
            },
        };

        applyReviewMoveDataDiff(
            navigation,
            ["7g7f", "3c3d"],
            [{ evalCp: 111, elapsedMs: 1000 }],
            [{ evalCp: 123, elapsedMs: 1000 }, { evalMate: Number.POSITIVE_INFINITY }],
        );

        expect(calls).toEqual([
            {
                ply: 1,
                update: { elapsedMs: 1000, scoreCp: 123, scoreMate: undefined },
                usiMove: "7g7f",
            },
            {
                ply: 2,
                update: {
                    elapsedMs: undefined,
                    scoreCp: undefined,
                    scoreMate: Number.POSITIVE_INFINITY,
                },
                usiMove: "3c3d",
            },
        ]);
    });
});

const setupInitialReviewSyncHarness = (
    initialReview: {
        sfen: string;
        moves: string[];
        moveData?: (ReviewMoveEval | undefined)[];
    },
    harnessOptions?: { beforeImportApply?: () => Promise<void> },
) => {
    const importCalls: Array<{
        sfen: string;
        moves: string[];
        moveData?: (ReviewMoveEval | undefined)[];
    }> = [];

    const hook = renderHook(
        ({ review }) => {
            const navigation = useKifuNavigation({
                initialPosition: createInitialPositionState(),
                initialSfen: "startpos",
            });

            const importSfen = async (
                sfen: string,
                moves: string[],
                options?: {
                    gotoPly?: number;
                    moveData?: (ReviewMoveEval | undefined)[];
                    isStale?: () => boolean;
                },
            ) => {
                importCalls.push({ sfen, moves: [...moves], moveData: options?.moveData });
                await harnessOptions?.beforeImportApply?.();
                if (options?.isStale?.()) return;

                navigation.reset(createInitialPositionState(), sfen);
                let position = createInitialPositionState();
                for (let index = 0; index < moves.length; index++) {
                    const move = moves[index];
                    const applied = applyMoveWithState(position, move, { validateTurn: false });
                    if (!applied.ok) break;

                    const data = options?.moveData?.[index];
                    navigation.addMove(move, applied.next, {
                        elapsedMs: data?.elapsedMs,
                        eval:
                            data?.evalCp !== undefined || data?.evalMate !== undefined
                                ? {
                                      scoreCp: data.evalCp,
                                      scoreMate: data.evalMate,
                                      normalized: true,
                                  }
                                : undefined,
                    });
                    position = applied.next;
                }
            };

            useInitialReviewSync({
                positionReady: true,
                initialReview: review,
                navigation,
                importSfen,
            });

            return navigation;
        },
        { initialProps: { review: initialReview } },
    );

    return { ...hook, importCalls };
};

describe("useInitialReviewSync", () => {
    it("import 未完了中に到着したコメント評価値を import 完了後に再適用する", async () => {
        let resolveImport: (() => void) | undefined;
        const importGate = new Promise<void>((resolve) => {
            resolveImport = resolve;
        });
        const { result, rerender, importCalls } = setupInitialReviewSyncHarness(
            {
                sfen: "startpos",
                moves: ["7g7f"],
            },
            { beforeImportApply: () => importGate },
        );

        await waitFor(() => expect(importCalls).toHaveLength(1));

        await act(async () => {
            rerender({
                review: {
                    sfen: "startpos",
                    moves: ["7g7f"],
                    moveData: [{ evalCp: 321, elapsedMs: 1500 }],
                },
            });
        });

        expect(result.current.kifMoves).toHaveLength(0);
        await act(async () => {
            resolveImport?.();
            await importGate;
        });

        await waitFor(() => expect(result.current.kifMoves[0]?.evalCp).toBe(321));
        expect(result.current.kifMoves[0]?.elapsedMs).toBe(1500);
        expect(importCalls).toHaveLength(1);
    });

    it("コメントのみが到着した場合は import せず diff 経路で実ナビゲーションへ反映する", async () => {
        const { result, rerender, importCalls } = setupInitialReviewSyncHarness({
            sfen: "startpos",
            moves: ["7g7f"],
        });

        await waitFor(() => expect(result.current.kifMoves).toHaveLength(1));
        expect(importCalls).toHaveLength(1);

        await act(async () => {
            rerender({
                review: {
                    sfen: "startpos",
                    moves: ["7g7f"],
                    moveData: [{ evalCp: 321, elapsedMs: 1500 }],
                },
            });
        });

        await waitFor(() => expect(result.current.kifMoves[0]?.evalCp).toBe(321));
        expect(result.current.kifMoves[0]?.elapsedMs).toBe(1500);
        expect(importCalls).toHaveLength(1);
    });

    it("指し手とコメントが同時に到着した場合は import 経路で moveData を反映する", async () => {
        const { result, rerender, importCalls } = setupInitialReviewSyncHarness({
            sfen: "startpos",
            moves: ["7g7f"],
        });

        await waitFor(() => expect(result.current.kifMoves).toHaveLength(1));
        expect(importCalls).toHaveLength(1);

        await act(async () => {
            rerender({
                review: {
                    sfen: "startpos",
                    moves: ["7g7f", "3c3d"],
                    moveData: [undefined, { evalCp: -88, elapsedMs: 2200 }],
                },
            });
        });

        await waitFor(() => expect(result.current.kifMoves).toHaveLength(2));
        expect(importCalls).toHaveLength(2);
        expect(importCalls[1]?.moveData?.[1]).toMatchObject({ evalCp: -88, elapsedMs: 2200 });
        expect(result.current.kifMoves[1]).toMatchObject({ evalCp: -88, elapsedMs: 2200 });
    });
});
