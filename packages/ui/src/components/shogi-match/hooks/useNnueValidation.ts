import type { NnueMeta, NnueSelection, PresetWithStatus } from "@shogi/app-core";
import { useEffect } from "react";

/**
 * NNUE 選択のバリデーションと自動修正のためのフック
 *
 * 以下のバリデーションを実行します:
 * 1. カスタム NNUE（presetKey が null）が削除された場合、デフォルトにリセット
 * 2. manifestUrl 未指定時にプリセット選択されている場合、リセット（ただしダウンロード済みなら保持）
 * 3. manifestUrl 指定時にプリセットキーが不正な場合、先頭プリセットまたはデフォルトにフォールバック
 */
export function useNnueValidation(deps: {
    /** 対局用 NNUE 選択（先手） */
    senteNnueSelection: NnueSelection;
    setSenteNnueSelection: (selection: NnueSelection) => void;
    /** 対局用 NNUE 選択（後手） */
    goteNnueSelection: NnueSelection;
    setGoteNnueSelection: (selection: NnueSelection) => void;
    /** 分析用 NNUE 選択 */
    analysisNnueSelection: NnueSelection;
    setAnalysisNnueSelection: (selection: NnueSelection) => void;
    /** ストレージ内の NNUE ファイル一覧 */
    nnueList: NnueMeta[];
    /** NNUE 一覧のロード状態 */
    isNnueListLoading: boolean;
    /** プリセット一覧 */
    presets: PresetWithStatus[];
    /** プリセット一覧のロード状態 */
    isPresetsLoading: boolean;
    /** デフォルトの NNUE 選択 */
    defaultNnueSelection: NnueSelection;
    /** manifest.json の URL（未指定時は null） */
    manifestUrl?: string;
    /** エンジンを再起動するコールバック */
    restartEngineForNnue?: ((side: "sente" | "gote", selection: NnueSelection) => void) | null;
}) {
    const {
        senteNnueSelection,
        setSenteNnueSelection,
        goteNnueSelection,
        setGoteNnueSelection,
        analysisNnueSelection,
        setAnalysisNnueSelection,
        nnueList,
        isNnueListLoading,
        presets,
        isPresetsLoading,
        defaultNnueSelection,
        manifestUrl,
        restartEngineForNnue,
    } = deps;

    // 1. カスタム NNUE が削除された場合のリセット
    useEffect(() => {
        if (isNnueListLoading) return;

        // カスタム NNUE（presetKey が null）で nnueId が設定されている場合のみチェック
        if (
            senteNnueSelection.presetKey === null &&
            senteNnueSelection.nnueId &&
            !nnueList.some((n) => n.id === senteNnueSelection.nnueId)
        ) {
            setSenteNnueSelection(defaultNnueSelection);
            restartEngineForNnue?.("sente", defaultNnueSelection);
        }

        if (
            goteNnueSelection.presetKey === null &&
            goteNnueSelection.nnueId &&
            !nnueList.some((n) => n.id === goteNnueSelection.nnueId)
        ) {
            setGoteNnueSelection(defaultNnueSelection);
            restartEngineForNnue?.("gote", defaultNnueSelection);
        }

        if (
            analysisNnueSelection.presetKey === null &&
            analysisNnueSelection.nnueId &&
            !nnueList.some((n) => n.id === analysisNnueSelection.nnueId)
        ) {
            setAnalysisNnueSelection(defaultNnueSelection);
        }
    }, [
        senteNnueSelection,
        goteNnueSelection,
        analysisNnueSelection,
        nnueList,
        isNnueListLoading,
        setSenteNnueSelection,
        setGoteNnueSelection,
        setAnalysisNnueSelection,
        defaultNnueSelection,
        restartEngineForNnue,
    ]);

    // 2. manifestUrl 未指定時のプリセット選択リセット
    useEffect(() => {
        if (manifestUrl) return;
        if (isNnueListLoading) return;

        const shouldReset = (presetKey: string | null): boolean => {
            if (!presetKey) return false;
            // nnueList に該当プリセットがダウンロード済みで存在するかチェック
            const existsInList = nnueList.some(
                (n) => n.source === "preset" && n.presetKey === presetKey,
            );
            // 存在しない場合のみリセット対象
            return !existsInList;
        };

        if (shouldReset(analysisNnueSelection.presetKey)) {
            setAnalysisNnueSelection({ presetKey: null, nnueId: null });
        }
        if (shouldReset(senteNnueSelection.presetKey)) {
            const newSelection = { presetKey: null, nnueId: null };
            setSenteNnueSelection(newSelection);
            restartEngineForNnue?.("sente", newSelection);
        }
        if (shouldReset(goteNnueSelection.presetKey)) {
            const newSelection = { presetKey: null, nnueId: null };
            setGoteNnueSelection(newSelection);
            restartEngineForNnue?.("gote", newSelection);
        }
    }, [
        manifestUrl,
        isNnueListLoading,
        nnueList,
        analysisNnueSelection.presetKey,
        senteNnueSelection.presetKey,
        goteNnueSelection.presetKey,
        setAnalysisNnueSelection,
        setSenteNnueSelection,
        setGoteNnueSelection,
        restartEngineForNnue,
    ]);

    // 3. manifestUrl 指定時のプリセットキーバリデーション
    useEffect(() => {
        if (!manifestUrl) return;
        if (isPresetsLoading) return;

        const validateAndFix = (
            selection: NnueSelection,
            setSelection: (s: NnueSelection) => void,
        ): NnueSelection | null => {
            // presetKey が設定されていない場合はバリデーション不要
            if (!selection.presetKey) return null;

            // presets が空の場合は駒得にフォールバック
            if (presets.length === 0) {
                const newSelection = { presetKey: null, nnueId: null };
                setSelection(newSelection);
                return newSelection;
            }

            // presetKey が presets に存在するかチェック
            const exists = presets.some((p) => p.config.presetKey === selection.presetKey);
            if (!exists) {
                // 先頭のプリセットにフォールバック
                const newSelection = { presetKey: presets[0].config.presetKey, nnueId: null };
                setSelection(newSelection);
                return newSelection;
            }
            return null;
        };

        const newSenteSelection = validateAndFix(senteNnueSelection, setSenteNnueSelection);
        const newGoteSelection = validateAndFix(goteNnueSelection, setGoteNnueSelection);
        validateAndFix(analysisNnueSelection, setAnalysisNnueSelection);

        // 選択が変更された場合、対局用エンジンを再起動
        if (newSenteSelection) {
            restartEngineForNnue?.("sente", newSenteSelection);
        }
        if (newGoteSelection) {
            restartEngineForNnue?.("gote", newGoteSelection);
        }
    }, [
        manifestUrl,
        isPresetsLoading,
        presets,
        senteNnueSelection,
        goteNnueSelection,
        analysisNnueSelection,
        setSenteNnueSelection,
        setGoteNnueSelection,
        setAnalysisNnueSelection,
        restartEngineForNnue,
    ]);
}
