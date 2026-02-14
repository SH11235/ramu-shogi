/**
 * AI解説生成フック
 *
 * 一括分析完了後の棋譜に対して、評価急落手の日本語解説を生成する。
 */

import type { KifuNode, KifuTree, MoveFeatures } from "@shogi/app-core";
import { useCallback, useRef, useState } from "react";
import type { CommentaryResult } from "../utils/commentaryService";
import {
    buildCommentaryInput,
    fetchCommentary,
    shouldGenerateCommentary,
} from "../utils/commentaryService";
import type { KifMove } from "../utils/kifFormat";

export interface CommentaryProgress {
    current: number;
    total: number;
}

/**
 * WASM版 MoveFeatures 取得コールバック
 *
 * SFEN + 手順 + 対象手から、isCheck を含む特徴量を返す。
 * apps/web から engine-wasm の wasm_get_move_features を渡す想定。
 */
export type GetWasmMoveFeatures = (
    sfen: string,
    moves: string[],
    targetMove: string,
    passRights?: { sente: number; gote: number },
) => MoveFeatures | null;

export interface UseCommentaryGenerationProps {
    kifMoves: KifMove[];
    tree: KifuTree;
    setCommentByPly: (ply: number, comment: string) => void;
    /** WASM版 MoveFeatures 取得（isCheck 付き）。未提供時は TypeScript 版を使用 */
    getWasmMoveFeatures?: GetWasmMoveFeatures;
}

export interface UseCommentaryGenerationReturn {
    /** 解説を一括生成する */
    generateCommentary: () => Promise<void>;
    /** 生成中かどうか */
    isGenerating: boolean;
    /** 生成の進捗 */
    progress: CommentaryProgress | null;
    /** 生成をキャンセルする */
    cancelGeneration: () => void;
}

/**
 * AI解説生成フック
 *
 * 一括分析済みの棋譜から、評価急落手（gap >= 200cp）を検出し、
 * ローカルLLM（llama-server）で解説を生成してKifuTreeに格納する。
 */
export function useCommentaryGeneration({
    kifMoves,
    tree,
    setCommentByPly,
    getWasmMoveFeatures,
}: UseCommentaryGenerationProps): UseCommentaryGenerationReturn {
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState<CommentaryProgress | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const generateCommentary = useCallback(async () => {
        // 前後のply間の評価値差で対象手を抽出
        const targets: { kifMove: KifMove; prevKifMove: KifMove }[] = [];
        for (let i = 1; i < kifMoves.length; i++) {
            if (shouldGenerateCommentary(kifMoves[i], kifMoves[i - 1])) {
                targets.push({ kifMove: kifMoves[i], prevKifMove: kifMoves[i - 1] });
            }
        }

        if (targets.length === 0) {
            return;
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;
        setIsGenerating(true);
        setProgress({ current: 0, total: targets.length });

        // WASM版がある場合、メインライン全体の手順を事前構築
        const mainLineMoves = getWasmMoveFeatures ? collectMainLineMoves(tree) : null;

        try {
            for (let i = 0; i < targets.length; i++) {
                if (controller.signal.aborted) break;

                const { kifMove, prevKifMove } = targets[i];
                const ply = kifMove.ply;

                // KifuTree からノードを取得
                const node = findNodeByPly(tree, ply);
                if (!node) continue;

                // WASM版でisCheck付きの特徴量を取得（可能な場合）
                let wasmFeatures: MoveFeatures | null = null;
                if (getWasmMoveFeatures && mainLineMoves && node.usiMove) {
                    wasmFeatures = tryGetWasmFeatures(
                        getWasmMoveFeatures,
                        tree.startSfen,
                        mainLineMoves,
                        ply,
                        node.usiMove,
                    );
                }

                // 入力データ構築（前の手の評価値・PVを参照して差分を計算）
                const input = buildCommentaryInput(
                    node,
                    kifMove,
                    node.positionAfter,
                    prevKifMove,
                    wasmFeatures ?? undefined,
                );
                if (!input) continue;

                // LLM 呼出（失敗時はフォールバック）
                const result: CommentaryResult = await fetchCommentary(input, {
                    signal: controller.signal,
                });

                if (controller.signal.aborted) break;

                // ツリーに格納
                setCommentByPly(ply, result.commentary);

                setProgress({ current: i + 1, total: targets.length });
            }
        } finally {
            setIsGenerating(false);
            setProgress(null);
            abortControllerRef.current = null;
        }
    }, [kifMoves, tree, setCommentByPly, getWasmMoveFeatures]);

    const cancelGeneration = useCallback(() => {
        abortControllerRef.current?.abort();
    }, []);

    return {
        generateCommentary,
        isGenerating,
        progress,
        cancelGeneration,
    };
}

/** メインラインから指定plyのノードを探す */
function findNodeByPly(tree: KifuTree, ply: number): KifuNode | null {
    let current = tree.nodes.get(tree.rootId);
    if (!current) return null;

    while (current.ply < ply) {
        if (current.children.length === 0) return null;
        // メインライン（最初の子）を辿る
        const nextId = current.children[0];
        const next = tree.nodes.get(nextId);
        if (!next) return null;
        current = next;
    }

    return current.ply === ply ? current : null;
}

/** メインラインのUSI手順を全て収集（ply順） */
function collectMainLineMoves(tree: KifuTree): string[] {
    const moves: string[] = [];
    let current = tree.nodes.get(tree.rootId);
    if (!current) return moves;

    while (current.children.length > 0) {
        const nextId = current.children[0];
        const next = tree.nodes.get(nextId);
        if (!next || !next.usiMove) break;
        moves.push(next.usiMove);
        current = next;
    }

    return moves;
}

/** WASM版 MoveFeatures を安全に取得（エラー時は null） */
function tryGetWasmFeatures(
    getWasmMoveFeatures: GetWasmMoveFeatures,
    sfen: string,
    mainLineMoves: string[],
    ply: number,
    targetMove: string,
): MoveFeatures | null {
    try {
        // ply=1 なら moves=[], ply=2 なら moves=[move1], ...
        const movesBefore = mainLineMoves.slice(0, ply - 1);
        return getWasmMoveFeatures(sfen, movesBefore, targetMove);
    } catch {
        return null;
    }
}
