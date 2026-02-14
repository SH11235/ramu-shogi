/**
 * 将棋解説AI サービス
 *
 * エンジン分析結果からLLM向け入力データを組み立て、
 * ローカルLLM（llama-server）で日本語解説を生成する。
 */

import type { KifuNode, MoveFeatures, PieceType, PositionState } from "@shogi/app-core";
import { extractMoveFeatures } from "@shogi/app-core";
import type { KifMove } from "./kifFormat";
import { convertPvToDisplay, formatMoveToKif, getPieceName } from "./kifFormat";

// ============================================================
// 型定義
// ============================================================

/** LLM 向け入力データ */
export interface CommentaryInput {
    /** 手数 */
    ply: number;
    /** 手番 */
    side: "sente" | "gote";
    /** KIF形式の指し手（例: "▲７六歩(77)"） */
    moveKif: string;
    /** 指し手の特徴 */
    moveFeatures: MoveFeatures;
    /** 実戦手の評価値（cp、先手視点） */
    playedEvalCp: number | undefined;
    /** 最善手の評価値（cp、先手視点） */
    bestEvalCp: number | undefined;
    /** 最善手との評価値差（cp、正の値） */
    gapCp: number;
    /** 最善手のKIF表記 */
    bestMoveKif: string | undefined;
    /** 最善手のPV表示（先頭数手） */
    bestPvDisplay: string | undefined;
    /** 判定 */
    verdict: "blunder" | "inaccuracy";
}

/** 解説生成結果 */
export interface CommentaryResult {
    /** 手数 */
    ply: number;
    /** 解説テキスト */
    commentary: string;
    /** 生成元 */
    source: "llm" | "fallback";
}

// ============================================================
// 駒種の日本語名マッピング
// ============================================================

const PIECE_JAPANESE: Record<PieceType, string> = {
    P: "歩",
    L: "香",
    N: "桂",
    S: "銀",
    G: "金",
    B: "角",
    R: "飛",
    K: "玉",
};

// ============================================================
// フィルタリング
// ============================================================

/**
 * この手について解説を生成すべきかを判定する
 *
 * 前後のply間で評価値が200cp以上急落した手を検出する。
 * 全ての評価値は先手視点に正規化済み。
 * - 先手の悪手: 評価値が下がる（prevEval > currentEval）
 * - 後手の悪手: 評価値が上がる（currentEval > prevEval、後手にとって不利）
 */
export function shouldGenerateCommentary(
    kifMove: KifMove,
    prevKifMove: KifMove | undefined,
): boolean {
    if (!prevKifMove) return false;

    const currentEval = kifMove.evalCp;
    const prevEval = prevKifMove.evalCp;

    if (currentEval === undefined || prevEval === undefined) return false;

    const isSente = kifMove.ply % 2 !== 0;
    const lossForPlayer = isSente ? prevEval - currentEval : currentEval - prevEval;

    return lossForPlayer >= 200;
}

// ============================================================
// 入力データ構築
// ============================================================

/**
 * LLM 向け入力データを組み立てる
 *
 * @param prevKifMove 前の手（最善手PV・評価値比較用）
 * @param wasmFeatures WASM版の特徴量（isCheck付き）。提供時はTypeScript版より優先
 */
export function buildCommentaryInput(
    node: KifuNode,
    kifMove: KifMove,
    positionAfter: PositionState,
    prevKifMove: KifMove,
    wasmFeatures?: MoveFeatures,
): CommentaryInput | null {
    if (!node.usiMove) return null;

    // WASM版があればそちらを使用（isCheck が含まれる）、なければTypeScript版
    const features = wasmFeatures ?? extractMoveFeatures(node.usiMove, node.boardBefore);
    if (!features) return null;

    // 評価値差の計算（前後のply間）
    // playedEvalCp = 実戦手適用後の局面の評価値（先手視点）
    // bestEvalCp = 実戦手適用前の局面の評価値（先手視点）= 最善手を指していた場合の期待値
    const playedEvalCp = kifMove.evalCp;
    const bestEvalCp = prevKifMove.evalCp;

    const isSente = node.ply % 2 !== 0;
    const gapCp =
        playedEvalCp !== undefined && bestEvalCp !== undefined
            ? isSente
                ? bestEvalCp - playedEvalCp
                : playedEvalCp - bestEvalCp
            : 0;

    // 最善手のPVは前の局面のPV1を使う（=この手の代わりに指すべきだった手）
    const bestPvEval = prevKifMove.multiPvEvals?.[0];

    // 最善手のKIF表記を生成
    let bestMoveKif: string | undefined;
    let bestPvDisplay: string | undefined;
    if (bestPvEval?.pv && bestPvEval.pv.length > 0) {
        // 最善手の1手目をKIFに変換するために、指し手適用前の局面の盤面を使う
        const bestFirstMove = bestPvEval.pv[0];
        const turn = isSente ? "sente" : "gote";
        bestMoveKif = formatMoveToKif(bestFirstMove, turn as "sente" | "gote", node.boardBefore);

        // 最善PVの表示（先頭5手まで）
        const positionBefore: PositionState = {
            board: node.boardBefore,
            hands: positionAfter.hands, // 近似値（厳密ではないが表示用には十分）
            turn: turn as "sente" | "gote",
        };
        const pvMoves = convertPvToDisplay(bestPvEval.pv.slice(0, 5), positionBefore);
        bestPvDisplay = pvMoves.map((m) => m.displayText).join(" ");
    }

    const side = isSente ? "sente" : "gote";

    return {
        ply: node.ply,
        side: side as "sente" | "gote",
        moveKif: kifMove.kifText,
        moveFeatures: features,
        playedEvalCp,
        bestEvalCp,
        gapCp,
        bestMoveKif,
        bestPvDisplay,
        verdict: gapCp >= 400 ? "blunder" : "inaccuracy",
    };
}

// ============================================================
// プロンプト構築
// ============================================================

function buildPromptMessages(input: CommentaryInput): {
    system: string;
    user: string;
} {
    const system = `あなたは将棋の棋譜分析アシスタントです。
入力データの数値・PV・move_featuresに基づき、日本語で簡潔に分析結果を説明してください。

ルール:
- PVに書かれていない手順を「〜と進む」のように断定しないでください
- move_featuresに無い駒名や戦法名を推測で使わないでください
- 「なぜ悪手か」は評価値の差とPVの比較で説明してください
- 1〜3文で簡潔に説明してください
- 解説文のみを出力してください（JSON不要）
/no_think`;

    // 駒名の日本語化
    const movedPieceName = features2Japanese(input.moveFeatures);

    const userData = {
        ply: input.ply,
        side: input.side === "sente" ? "先手" : "後手",
        moveKif: input.moveKif,
        movedPiece: movedPieceName,
        isCapture: input.moveFeatures.isCapture,
        capturedPiece: input.moveFeatures.capturedPiece
            ? (PIECE_JAPANESE[input.moveFeatures.capturedPiece] ?? input.moveFeatures.capturedPiece)
            : undefined,
        isPromote: input.moveFeatures.isPromote,
        isDrop: input.moveFeatures.isDrop,
        isCheck: input.moveFeatures.isCheck,
        playedEvalCp: input.playedEvalCp,
        bestEvalCp: input.bestEvalCp,
        gapCp: input.gapCp,
        verdict: input.verdict === "blunder" ? "悪手" : "疑問手",
        bestMoveKif: input.bestMoveKif,
        bestPvDisplay: input.bestPvDisplay,
    };

    return {
        system,
        user: JSON.stringify(userData, null, 2),
    };
}

function features2Japanese(features: MoveFeatures): string {
    const base = PIECE_JAPANESE[features.movedPiece] ?? features.movedPiece;
    if (features.movedPiecePromoted) {
        return getPieceName(features.movedPiece, true);
    }
    return base;
}

// ============================================================
// フォールバック
// ============================================================

/**
 * LLM を使わずにテンプレートから解説文を生成する
 */
export function buildFallbackCommentary(input: CommentaryInput): string {
    const verdictText = input.verdict === "blunder" ? "悪手" : "疑問手";
    const side = input.side === "sente" ? "先手" : "後手";

    const lines: string[] = [];

    lines.push(
        `${side}の${input.moveKif}は${verdictText}です。` +
            `評価値が${input.gapCp}cp下がりました。`,
    );

    if (input.bestMoveKif) {
        lines.push(`最善手は${input.bestMoveKif}でした。`);
    }

    if (input.bestPvDisplay) {
        lines.push(`最善の読み筋: ${input.bestPvDisplay}`);
    }

    return lines.join(" ");
}

// ============================================================
// LLM 呼出
// ============================================================

interface FetchCommentaryOptions {
    baseUrl?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * llama-server に解説を生成させる
 *
 * 失敗時はフォールバックテンプレートを返す。
 */
export async function fetchCommentary(
    input: CommentaryInput,
    options?: FetchCommentaryOptions,
): Promise<CommentaryResult> {
    const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const { system, user } = buildPromptMessages(input);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        // 外部シグナルとタイムアウトの統合
        if (options?.signal) {
            options.signal.addEventListener("abort", () => controller.abort());
        }

        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "qwen3-8b",
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                temperature: 0.7,
                max_tokens: 300,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`LLM API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;

        if (typeof content !== "string" || content.trim().length === 0) {
            throw new Error("Empty response from LLM");
        }

        // 基本的な検証: 長すぎる場合は切り詰め
        const trimmed = content.trim().slice(0, 500);

        return {
            ply: input.ply,
            commentary: trimmed,
            source: "llm",
        };
    } catch {
        // フォールバック
        return {
            ply: input.ply,
            commentary: buildFallbackCommentary(input),
            source: "fallback",
        };
    }
}
