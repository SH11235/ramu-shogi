/**
 * useNnueManager
 *
 * NNUE管理を統合するフック
 * - 対局用NNUE選択（先手・後手）
 * - 分析用NNUE選択
 * - NNUEファイル一覧・プリセット管理
 * - マイグレーション・バリデーション
 */

import type { NnueMeta, NnueSelection, Player, PresetConfig } from "@shogi/app-core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLazyNnueLoader } from "../../hooks/useLazyNnueLoader";
import { useNnueStorage } from "../../hooks/useNnueStorage";
import { usePresetManager } from "../../hooks/usePresetManager";
import { useLocalStorage } from "./useLocalStorage";
import { useNnueMigration } from "./useNnueMigration";
import { useNnueValidation } from "./useNnueValidation";

interface UseNnueManagerParams {
    /** デフォルトのNNUE選択 */
    defaultNnueSelection: NnueSelection;
    /** プリセットmanifest URL */
    manifestUrl?: string;
    /** エンジン再起動コールバック */
    restartEngineForNnue: (side: Player, selection?: NnueSelection) => Promise<void>;
}

interface UseNnueManagerResult {
    // 対局用NNUE選択
    senteNnueSelection: NnueSelection;
    setSenteNnueSelection: (selection: NnueSelection) => void;
    handleSenteNnueSelectionChange: (selection: NnueSelection) => void;
    goteNnueSelection: NnueSelection;
    setGoteNnueSelection: (selection: NnueSelection) => void;
    handleGoteNnueSelectionChange: (selection: NnueSelection) => void;

    // 分析用NNUE選択
    analysisNnueSelection: NnueSelection;
    setAnalysisNnueSelection: (selection: NnueSelection) => void;
    analysisNnueId: string | null;

    // NNUEファイル一覧
    nnueList: NnueMeta[];
    isNnueListLoading: boolean;
    refreshNnueList: () => Promise<void>;

    // プリセット
    presets: ReturnType<typeof usePresetManager>["presets"];
    isPresetsLoading: boolean;
    presetConfigs: PresetConfig[];

    // ユーティリティ
    resolveNnue: (selection: NnueSelection) => Promise<string>;
    getPresetDisplayName: (presetKey: string) => string | undefined;
}

/**
 * NNUE管理を統合するフック
 */
export function useNnueManager({
    defaultNnueSelection,
    manifestUrl,
    restartEngineForNnue,
}: UseNnueManagerParams): UseNnueManagerResult {
    // 対局用 NNUE 選択
    const [senteNnueSelection, setSenteNnueSelection] = useLocalStorage<NnueSelection>(
        "shogi:senteNnueSelection",
        defaultNnueSelection,
    );
    const [goteNnueSelection, setGoteNnueSelection] = useLocalStorage<NnueSelection>(
        "shogi:goteNnueSelection",
        defaultNnueSelection,
    );

    // 分析用 NNUE 選択
    const [analysisNnueSelection, setAnalysisNnueSelection] = useLocalStorage<NnueSelection>(
        "shogi:analysisNnueSelection",
        defaultNnueSelection,
    );

    // NNUE再起動用のref（マイグレーション・バリデーションで使用）
    const restartEngineForNnueRef = useRef<
        ((side: Player, selection?: NnueSelection) => Promise<void>) | null
    >(null);
    restartEngineForNnueRef.current = restartEngineForNnue;

    // NNUE ストレージから一覧を取得
    const {
        nnueList,
        isLoading: isNnueListLoading,
        refreshList: refreshNnueList,
    } = useNnueStorage();

    // プリセット一覧を取得
    const { presets, isLoading: isPresetsLoading } = usePresetManager({
        manifestUrl,
        autoFetch: true,
        onDownloadComplete: () => {
            // ダウンロード完了時にストレージを更新
            void refreshNnueList();
        },
    });

    // presetKey から displayName を取得する関数
    const getPresetDisplayName = useCallback(
        (presetKey: string): string | undefined => {
            const preset = presets.find((p) => p.config.presetKey === presetKey);
            return preset?.config.displayName;
        },
        [presets],
    );

    // NNUE 解決フック（未ダウンロードのプリセットはエラーをスロー）
    const { resolveNnue } = useLazyNnueLoader({ getPresetDisplayName });

    // 旧キーからのNNUE選択マイグレーション
    useNnueMigration({
        setSenteNnueSelection,
        setGoteNnueSelection,
        setAnalysisNnueSelection,
        restartEngineForNnue: (side, selection) =>
            void restartEngineForNnueRef.current?.(side, selection),
    });

    // NNUE 選択のバリデーションと自動修正
    useNnueValidation({
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
        restartEngineForNnue: (side, selection) =>
            void restartEngineForNnueRef.current?.(side, selection),
    });

    // 分析用 NNUE ID の導出
    // preset 選択時は nnueList からダウンロード済みの NNUE を探す
    const analysisNnueId = useMemo(() => {
        if (analysisNnueSelection.nnueId) {
            return analysisNnueSelection.nnueId;
        }
        if (analysisNnueSelection.presetKey) {
            const presetNnue = nnueList.find(
                (n) => n.source === "preset" && n.presetKey === analysisNnueSelection.presetKey,
            );
            return presetNnue?.id ?? null;
        }
        return null;
    }, [analysisNnueSelection, nnueList]);

    // プリセット設定のみを抽出（UIコンポーネント用）
    const presetConfigs = useMemo(() => presets.map((p) => p.config), [presets]);

    // NNUE選択変更時にエンジンを再起動するラッパー（先手）
    const handleSenteNnueSelectionChange = useCallback(
        (newSelection: NnueSelection) => {
            setSenteNnueSelection(newSelection);
            // 新しいselectionを明示的に渡す（state更新前に参照されるのを防ぐ）
            void restartEngineForNnue("sente", newSelection);
        },
        [restartEngineForNnue, setSenteNnueSelection],
    );

    // NNUE選択変更時にエンジンを再起動するラッパー（後手）
    const handleGoteNnueSelectionChange = useCallback(
        (newSelection: NnueSelection) => {
            setGoteNnueSelection(newSelection);
            // 新しいselectionを明示的に渡す（state更新前に参照されるのを防ぐ）
            void restartEngineForNnue("gote", newSelection);
        },
        [restartEngineForNnue, setGoteNnueSelection],
    );

    return {
        // 対局用NNUE
        senteNnueSelection,
        setSenteNnueSelection,
        handleSenteNnueSelectionChange,
        goteNnueSelection,
        setGoteNnueSelection,
        handleGoteNnueSelectionChange,
        // 分析用NNUE
        analysisNnueSelection,
        setAnalysisNnueSelection,
        analysisNnueId,
        // NNUE一覧
        nnueList,
        isNnueListLoading,
        refreshNnueList,
        // プリセット
        presets,
        isPresetsLoading,
        presetConfigs,
        // ユーティリティ
        resolveNnue,
        getPresetDisplayName,
    };
}
