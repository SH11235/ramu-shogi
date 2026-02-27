import type { NnueSelection, ResolvedNnue } from "@shogi/app-core";
import { NnueError } from "@shogi/app-core";
import { useState } from "react";
import { useNnueContextOptional } from "../providers/NnueContext";

interface UseLazyNnueLoaderOptions {
    /**
     * presetKey から表示名を取得する関数
     * 指定しない場合は presetKey がそのまま表示される
     */
    getPresetDisplayName?: (presetKey: string) => string | undefined;
}

interface UseLazyNnueLoaderReturn {
    /**
     * NNUE を解決する
     * @param selection NNUE 選択状態
     * @returns 解決済みの ResolvedNnue（nnueId と fvScale）、または null（駒得評価）
     * @throws NnueError 未ダウンロードのプリセットが指定された場合
     */
    resolveNnue: (selection: NnueSelection) => Promise<ResolvedNnue | null>;
    /** エラー */
    error: NnueError | null;
    /** エラーをクリア */
    clearError: () => void;
}

/**
 * NNUE 解決フック
 *
 * NnueSelection を受け取り、実際の nnueId を返す。
 * プリセット指定の場合、IndexedDB にあればその id を返し、
 * なければエラーをスロー（自動ダウンロードはしない）。
 */
export function useLazyNnueLoader(options?: UseLazyNnueLoaderOptions): UseLazyNnueLoaderReturn {
    const { getPresetDisplayName } = options ?? {};
    const context = useNnueContextOptional();
    const storage = context?.storage ?? null;

    const [error, setError] = useState<NnueError | null>(null);

    /**
     * nnueId から ResolvedNnue を作成するヘルパー
     * @throws NnueError fvScale が設定されていない場合
     */
    const createResolvedNnue = async (nnueId: string): Promise<ResolvedNnue> => {
        if (!storage) {
            throw new NnueError("NNUE_RESOLVE_FAILED", "評価関数ストレージが利用できません。");
        }
        const meta = await storage.getMeta(nnueId);
        if (!meta) {
            throw new NnueError("NNUE_RESOLVE_FAILED", "評価関数ファイルが見つかりません。");
        }
        if (meta.fvScale === undefined) {
            throw new NnueError(
                "NNUE_RESOLVE_FAILED",
                `評価関数「${meta.displayName}」の FV_SCALE が未設定です。評価関数ファイル管理を開いて FV_SCALE を設定してください。`,
            );
        }
        return {
            nnueId,
            fvScale: meta.fvScale,
        };
    };

    /**
     * NNUE を解決する
     *
     * 1. presetKey が null → nnueId をそのまま返す（fvScale も取得）
     * 2. presetKey が設定されている:
     *    a. IndexedDB に該当 presetKey の NNUE があるか確認
     *    b. あれば → その id と fvScale を返す
     *    c. なければ → エラーをスロー（自動ダウンロードはしない）
     */
    const resolveNnue = async (selection: NnueSelection): Promise<ResolvedNnue | null> => {
        setError(null);

        try {
            // プリセット指定でない場合は nnueId をそのまま返す（fvScale も取得）
            if (!selection.presetKey) {
                if (!selection.nnueId) {
                    return null;
                }
                return createResolvedNnue(selection.nnueId);
            }

            // storage がない場合はエラー（fvScale を解決できない）
            if (!storage) {
                throw new NnueError("NNUE_RESOLVE_FAILED", "評価関数ストレージが利用できません。");
            }

            const presetKey = selection.presetKey;

            // IndexedDB に該当 presetKey の NNUE があるか確認
            const existing = await storage.listByPresetKey(presetKey);
            if (existing.length > 0) {
                // 最新の作成日時のものを返す
                const sorted = [...existing].sort((a, b) => b.createdAt - a.createdAt);
                const meta = sorted[0];
                if (meta.fvScale === undefined) {
                    const displayName =
                        (meta.presetKey && getPresetDisplayName?.(meta.presetKey)) ||
                        meta.displayName;
                    throw new NnueError(
                        "NNUE_RESOLVE_FAILED",
                        `評価関数「${displayName}」の FV_SCALE が未設定です。評価関数ファイル管理を開いて FV_SCALE を設定してください。`,
                    );
                }
                return {
                    nnueId: meta.id,
                    fvScale: meta.fvScale,
                };
            }

            // 未ダウンロードのプリセット → エラーをスロー
            const displayName = getPresetDisplayName?.(presetKey) ?? presetKey;
            throw new NnueError(
                "NNUE_NOT_DOWNLOADED",
                `評価関数「${displayName}」がダウンロードされていません。評価関数ファイル管理からダウンロードしてください。`,
            );
        } catch (e) {
            if (e instanceof NnueError) {
                setError(e);
                throw e;
            }
            const err = new NnueError("NNUE_RESOLVE_FAILED", "評価関数の解決に失敗しました", e);
            setError(err);
            throw err;
        }
    };

    const clearError = () => {
        setError(null);
    };

    return {
        resolveNnue,
        error,
        clearError,
    };
}
