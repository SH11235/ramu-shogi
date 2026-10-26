import { useEffect, useRef } from "react";
import type { AnalysisSettings, AnalysisSnapshotDraft, AnalysisSnapshotEntryDraft } from "../types";
import { infinitySafeReplacer } from "../utils/infinitySafeReplacer";
import type { KifMove } from "../utils/kifFormat";
import type { RecordedEvalInfoEvent } from "./useKifuNavigation";

export const analysisSnapshotEntryToRecordedEvalInfoEvent = (
    entry: AnalysisSnapshotEntryDraft,
): RecordedEvalInfoEvent => ({
    type: "info",
    scoreCp: entry.evalCp ?? undefined,
    scoreMate: entry.evalMate ?? undefined,
    depth: entry.depth ?? undefined,
    pv: entry.pv ?? undefined,
    multipv: 1,
    normalized: true,
});

/** 保存済み snapshot の multiPv 候補 1 件を再適用用イベントへ変換する (multipv 番号を保持)。 */
export const analysisSnapshotMultiPvToRecordedEvalInfoEvent = (
    multiPv: NonNullable<AnalysisSnapshotEntryDraft["multiPv"]>[number],
): RecordedEvalInfoEvent => ({
    type: "info",
    scoreCp: multiPv.evalCp ?? undefined,
    scoreMate: multiPv.evalMate ?? undefined,
    depth: multiPv.depth ?? undefined,
    pv: multiPv.pv ?? undefined,
    multipv: multiPv.multipv,
    normalized: true,
});

/**
 * 保存済み snapshot の 1 entry を棋譜ツリーへ再適用する。ply の評価を一旦クリアし、
 * 主評価 (multipv:1) と各 multiPv 候補を multipv スロットごとに記録する。
 * multiPv に multipv:1 が含まれても、主評価との二重記録は setNodeMultiPvEval の
 * 深さ比較で吸収されるため無害 (multiPv が空/なしの経路のため主評価記録は残す)。
 */
export const applyAnalysisSnapshotEntryEvals = (
    entry: AnalysisSnapshotEntryDraft,
    handlers: {
        clearEvalByPly: (ply: number) => void;
        recordEvalByPly: (ply: number, event: RecordedEvalInfoEvent) => void;
    },
): void => {
    handlers.clearEvalByPly(entry.ply);
    handlers.recordEvalByPly(entry.ply, analysisSnapshotEntryToRecordedEvalInfoEvent(entry));
    for (const multiPv of entry.multiPv ?? []) {
        handlers.recordEvalByPly(
            entry.ply,
            analysisSnapshotMultiPvToRecordedEvalInfoEvent(multiPv),
        );
    }
};

/**
 * いまの局面（開始局面と手順）と、棋譜に付いた解析結果を、変わったときだけ呼び出し側へ知らせる。
 */
export function useMatchSnapshotReports({
    startSfen,
    moves,
    kifMoves,
    analysisSettings,
    onPositionSnapshot,
    onAnalysisSnapshotChange,
}: {
    startSfen: string;
    moves: string[];
    kifMoves: KifMove[];
    analysisSettings: AnalysisSettings;
    onPositionSnapshot?: (snapshot: { sfen: string; moves: string[]; label?: string }) => void;
    onAnalysisSnapshotChange?: (snapshot: AnalysisSnapshotDraft | null) => void;
}): void {
    const movesKey = moves.join(" ");
    const lastSnapshotRef = useRef<{ sfen: string; movesKey: string } | null>(null);

    useEffect(() => {
        const prev = lastSnapshotRef.current;
        if (prev && prev.sfen === startSfen && prev.movesKey === movesKey) {
            return;
        }
        lastSnapshotRef.current = { sfen: startSfen, movesKey };
        onPositionSnapshot?.({
            sfen: startSfen,
            moves,
            label: "現在局面",
        });
    }, [moves, movesKey, onPositionSnapshot, startSfen]);

    const analysisSnapshotDraft = (() => {
        const entries = kifMoves
            .filter(
                (move) =>
                    move.evalCp !== undefined ||
                    move.evalMate !== undefined ||
                    move.depth !== undefined ||
                    move.pv !== undefined ||
                    move.multiPvEvals !== undefined,
            )
            .map((move) => ({
                ply: move.ply,
                evalCp: move.evalCp ?? null,
                evalMate: move.evalMate ?? null,
                depth: move.depth ?? null,
                pv: move.pv ?? null,
                multiPv: move.multiPvEvals ?? null,
            }));

        if (entries.length === 0) {
            return null;
        }

        return {
            startSfen,
            lineMoves: kifMoves.map((move) => move.usiMove),
            analysisSettings,
            entries,
        } satisfies AnalysisSnapshotDraft;
    })();
    const lastAnalysisSnapshotSignatureRef = useRef<string | null>(null);

    useEffect(() => {
        // analysisSnapshotDraft は live 由来の手数なし詰み (evalMate=±Infinity) を含みうる。
        // 素の JSON.stringify は ±Infinity をどちらも null にして符号を潰すため、
        // signature 比較では符号を保持する infinitySafeReplacer を使う。
        const signature = analysisSnapshotDraft
            ? JSON.stringify(analysisSnapshotDraft, infinitySafeReplacer)
            : null;
        if (lastAnalysisSnapshotSignatureRef.current === signature) {
            return;
        }
        lastAnalysisSnapshotSignatureRef.current = signature;
        onAnalysisSnapshotChange?.(analysisSnapshotDraft);
    }, [analysisSnapshotDraft, onAnalysisSnapshotChange]);
}

/** 呼び出し側から渡された保存済みの解析結果を、局面の準備ができてから棋譜ツリーへ適用する（中身が変わるたびに適用し直す）。 */
export function useInitialAnalysisEntries({
    positionReady,
    initialAnalysisEntries,
    clearEvalByPly,
    recordEvalByPly,
}: {
    positionReady: boolean;
    initialAnalysisEntries: AnalysisSnapshotEntryDraft[] | null;
    clearEvalByPly: (ply: number) => void;
    recordEvalByPly: (ply: number, event: RecordedEvalInfoEvent) => void;
}): void {
    const initialAnalysisAppliedRef = useRef<string | null>(null);

    useEffect(() => {
        if (!positionReady || !initialAnalysisEntries || initialAnalysisEntries.length === 0) {
            return;
        }

        // 復元済み snapshot は evalMate=±Infinity (手数なし詰み) を含みうる。素の
        // JSON.stringify は ±Infinity をどちらも null に潰し符号違いの snapshot 切替を
        // 取りこぼすため、符号を保持する infinitySafeReplacer で署名する。
        const signature = JSON.stringify(initialAnalysisEntries, infinitySafeReplacer);
        if (initialAnalysisAppliedRef.current === signature) {
            return;
        }

        for (const entry of initialAnalysisEntries) {
            applyAnalysisSnapshotEntryEvals(entry, { clearEvalByPly, recordEvalByPly });
        }

        initialAnalysisAppliedRef.current = signature;
    }, [clearEvalByPly, initialAnalysisEntries, positionReady, recordEvalByPly]);
}
