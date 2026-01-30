import type { NnueSelection } from "@shogi/app-core";
import { useEffect } from "react";
import { LEGACY_STORAGE_KEYS } from "../constants";

/**
 * localStorage から旧キーの NNUE ID を読み取り、新しい NnueSelection に変換する
 *
 * @param key - 読み取る localStorage キー
 * @returns NnueSelection または null（キーが存在しない、またはパースエラー）
 */
function migrateLegacyNnueId(key: string): NnueSelection | null {
    if (typeof window === "undefined") return null;

    const stored = localStorage.getItem(key);
    if (stored === null) return null;

    try {
        const parsed = JSON.parse(stored) as string | null;
        if (parsed) {
            return { presetKey: null, nnueId: parsed };
        }
    } catch (error) {
        console.warn(`Failed to parse localStorage key "${key}":`, error);
    } finally {
        // マイグレーション後は旧キーを削除
        localStorage.removeItem(key);
    }

    return null;
}

/**
 * NNUE 選択の localStorage マイグレーション用フック
 *
 * 旧キーから新キーへの自動マイグレーションを実行します。
 * 以下の順序でマイグレーションを試みます:
 * 1. shogi:senteNnueId → senteNnueSelection
 * 2. shogi:goteNnueId → goteNnueSelection
 * 3. shogi:analysisNnueId → analysisNnueSelection
 * 4. shogi:matchNnueId → senteNnueSelection + goteNnueSelection（最も古いキー）
 *
 * @param deps - マイグレーション実行に必要な依存
 */
export function useNnueMigration(deps: {
    setSenteNnueSelection: (selection: NnueSelection) => void;
    setGoteNnueSelection: (selection: NnueSelection) => void;
    setAnalysisNnueSelection: (selection: NnueSelection) => void;
    /** エンジンを再起動するコールバック（対局用エンジンのNNUE切り替え時に呼ばれる） */
    restartEngineForNnue?: ((side: "sente" | "gote", selection: NnueSelection) => void) | null;
}) {
    const {
        setSenteNnueSelection,
        setGoteNnueSelection,
        setAnalysisNnueSelection,
        restartEngineForNnue,
    } = deps;

    useEffect(() => {
        // 旧 senteNnueId からの移行
        const oldSente = migrateLegacyNnueId(LEGACY_STORAGE_KEYS.senteNnueId);
        if (oldSente) {
            setSenteNnueSelection(oldSente);
            restartEngineForNnue?.("sente", oldSente);
        }

        // 旧 goteNnueId からの移行
        const oldGote = migrateLegacyNnueId(LEGACY_STORAGE_KEYS.goteNnueId);
        if (oldGote) {
            setGoteNnueSelection(oldGote);
            restartEngineForNnue?.("gote", oldGote);
        }

        // 旧 analysisNnueId からの移行
        const oldAnalysis = migrateLegacyNnueId(LEGACY_STORAGE_KEYS.analysisNnueId);
        if (oldAnalysis) {
            setAnalysisNnueSelection(oldAnalysis);
        }

        // さらに古い matchNnueId からの移行（sente/gote 両方に適用）
        const legacyMatch = migrateLegacyNnueId(LEGACY_STORAGE_KEYS.matchNnueId);
        if (legacyMatch) {
            setSenteNnueSelection(legacyMatch);
            setGoteNnueSelection(legacyMatch);
        }
    }, [
        setSenteNnueSelection,
        setGoteNnueSelection,
        setAnalysisNnueSelection,
        restartEngineForNnue,
    ]);
}
