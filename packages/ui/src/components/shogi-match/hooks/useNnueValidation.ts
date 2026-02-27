import type { NnueMeta, NnueSelection, PresetWithStatus } from "@shogi/app-core";
import { useCallback, useEffect, useRef } from "react";

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
    /** プリセット取得の試行済みフラグ */
    hasFetchedPresets: boolean;
    /** localStorageに選択が保存されているか */
    hasStoredSenteSelection: boolean;
    hasStoredGoteSelection: boolean;
    hasStoredAnalysisSelection: boolean;
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
        hasFetchedPresets,
        hasStoredSenteSelection,
        hasStoredGoteSelection,
        hasStoredAnalysisSelection,
        defaultNnueSelection,
        manifestUrl,
        restartEngineForNnue,
    } = deps;

    const hasLoggedMaterialDefaultRef = useRef(false);

    const logFallback = useCallback((reason: string, detail: Record<string, unknown>) => {
        console.warn("[nnue] fallback", { reason, ...detail });
    }, []);

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
            logFallback("missing-custom-nnue", { side: "sente" });
        }

        if (
            goteNnueSelection.presetKey === null &&
            goteNnueSelection.nnueId &&
            !nnueList.some((n) => n.id === goteNnueSelection.nnueId)
        ) {
            setGoteNnueSelection(defaultNnueSelection);
            restartEngineForNnue?.("gote", defaultNnueSelection);
            logFallback("missing-custom-nnue", { side: "gote" });
        }

        if (
            analysisNnueSelection.presetKey === null &&
            analysisNnueSelection.nnueId &&
            !nnueList.some((n) => n.id === analysisNnueSelection.nnueId)
        ) {
            setAnalysisNnueSelection(defaultNnueSelection);
            logFallback("missing-custom-nnue", { side: "analysis" });
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
        logFallback,
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
            logFallback("manifest-url-missing", { side: "analysis" });
        }
        if (shouldReset(senteNnueSelection.presetKey)) {
            const newSelection = { presetKey: null, nnueId: null };
            setSenteNnueSelection(newSelection);
            restartEngineForNnue?.("sente", newSelection);
            logFallback("manifest-url-missing", { side: "sente" });
        }
        if (shouldReset(goteNnueSelection.presetKey)) {
            const newSelection = { presetKey: null, nnueId: null };
            setGoteNnueSelection(newSelection);
            restartEngineForNnue?.("gote", newSelection);
            logFallback("manifest-url-missing", { side: "gote" });
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
        logFallback,
    ]);

    // 3. manifestUrl 指定時のプリセットキーバリデーション
    useEffect(() => {
        if (!manifestUrl) return;
        if (isPresetsLoading) return;
        if (!hasFetchedPresets) return;

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
                logFallback("preset-empty", { side: "unknown" });
                return newSelection;
            }

            // presetKey が presets に存在するかチェック
            const exists = presets.some((p) => p.config.presetKey === selection.presetKey);
            if (!exists) {
                // 先頭のプリセットにフォールバック
                const newSelection = { presetKey: presets[0].config.presetKey, nnueId: null };
                setSelection(newSelection);
                logFallback("invalid-preset-key", {
                    side: "unknown",
                    presetKey: selection.presetKey,
                    nextPresetKey: presets[0]?.config.presetKey,
                });
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
        hasFetchedPresets,
        presets,
        senteNnueSelection,
        goteNnueSelection,
        analysisNnueSelection,
        setSenteNnueSelection,
        setGoteNnueSelection,
        setAnalysisNnueSelection,
        restartEngineForNnue,
        logFallback,
    ]);

    useEffect(() => {
        if (!manifestUrl) return;
        if (isPresetsLoading) return;
        if (!hasFetchedPresets) return;

        const isDefaultPreset =
            defaultNnueSelection.presetKey !== null && defaultNnueSelection.nnueId === null;
        if (!isDefaultPreset) return;

        const isSenteMaterial =
            senteNnueSelection.presetKey === null && senteNnueSelection.nnueId === null;
        const isGoteMaterial =
            goteNnueSelection.presetKey === null && goteNnueSelection.nnueId === null;
        const isAnalysisMaterial =
            analysisNnueSelection.presetKey === null && analysisNnueSelection.nnueId === null;

        if (!hasStoredSenteSelection && isSenteMaterial) {
            setSenteNnueSelection(defaultNnueSelection);
            restartEngineForNnue?.("sente", defaultNnueSelection);
            logFallback("material-default-migrated", { side: "sente" });
        }

        if (!hasStoredGoteSelection && isGoteMaterial) {
            setGoteNnueSelection(defaultNnueSelection);
            restartEngineForNnue?.("gote", defaultNnueSelection);
            logFallback("material-default-migrated", { side: "gote" });
        }

        if (!hasStoredAnalysisSelection && isAnalysisMaterial) {
            setAnalysisNnueSelection(defaultNnueSelection);
            logFallback("material-default-migrated", { side: "analysis" });
        }

        if (hasLoggedMaterialDefaultRef.current) return;
        if (hasStoredSenteSelection && isSenteMaterial) {
            hasLoggedMaterialDefaultRef.current = true;
            logFallback("selection-stored-as-material", { side: "sente" });
        }
    }, [
        manifestUrl,
        isPresetsLoading,
        hasFetchedPresets,
        defaultNnueSelection,
        hasStoredSenteSelection,
        hasStoredGoteSelection,
        hasStoredAnalysisSelection,
        senteNnueSelection,
        goteNnueSelection,
        analysisNnueSelection,
        setSenteNnueSelection,
        setGoteNnueSelection,
        setAnalysisNnueSelection,
        restartEngineForNnue,
        logFallback,
    ]);
}
