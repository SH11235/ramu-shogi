import {
    applyMoveWithState,
    getPositionService,
    type LastMove,
    type PieceType,
    type Player,
    type PositionState,
    type Square,
} from "@shogi/app-core";
import type { MutableRefObject } from "react";
import type { Message, PromotionSelection } from "../types";
import type { LegalMoveCache } from "../utils/legalMoveCache";
import { determinePromotion } from "../utils/promotionLogic";
import type { UseKifuNavigationResult } from "./useKifuNavigation";

type Selection = { kind: "square"; square: string } | { kind: "hand"; piece: PieceType };

/**
 * useMoveExecution の props
 */
interface UseMoveExecutionProps {
    /** 局面状態 */
    position: PositionState;
    /** 棋譜ナビゲーション */
    navigation: UseKifuNavigationResult;
    /** 編集モードかどうか */
    isEditMode: boolean;
    /** 検討モードかどうか */
    isReviewMode: boolean;
    /** 一時停止中かどうか */
    isPaused: boolean;
    /** 局面準備完了かどうか */
    positionReady: boolean;
    /** 合法手取得関数（外部提供） */
    fetchLegalMoves?: (
        sfen: string,
        moves: string[],
        options?: { passRights?: { sente: number; gote: number } },
    ) => Promise<string[]>;
    /** 開始局面のSFEN */
    startSfen: string;
    /** 指し手配列 */
    moves: string[];
    /** 合法手キャッシュ */
    legalCache: LegalMoveCache;
    /** 合法手キャッシュをクリアする */
    clearLegalCache: () => void;
    /** パス合法フラグを設定する */
    setCanPassLegal: (value: boolean) => void;
    /** パス権オプションを取得する */
    getPassRightsOption: () => { passRights?: { sente: number; gote: number } };
    /** 次の手番に時計を更新する */
    updateClocksForNextTurn: (turn: Player) => void;
    /** ターン開始時刻のref */
    turnStartTimeRef: MutableRefObject<number>;
    /** エンジンの手番かどうか */
    isEngineTurn: (turn: Player) => boolean;
    /** 現在の選択 */
    selection: Selection | null;
    /** 選択を設定する */
    setSelection: (selection: Selection | null) => void;
    /** 成り選択状態 */
    promotionSelection: PromotionSelection | null;
    /** 成り選択状態を設定する */
    setPromotionSelection: (selection: PromotionSelection | null) => void;
    /** 最後の手を設定する */
    setLastMove: (lastMove: LastMove | undefined) => void;
    /** メッセージを設定する */
    setMessage: (message: Message | null) => void;
    /** 最後に追加された分岐情報を設定する */
    setLastAddedBranchInfo: (info: { ply: number; firstMove: string } | null) => void;
    /** 編集モードの移動元マス */
    editFromSquare: Square | null;
    /** 編集モードの移動元マスを設定する */
    setEditFromSquare: (square: Square | null) => void;
    /** 編集ツール */
    editTool: "place" | "erase";
    /** 編集する駒種 */
    editPieceType: PieceType | null;
    /** 編集する駒の所有者 */
    editOwner: Player;
    /** 編集する駒が成りかどうか */
    editPromoted: boolean;
    /** 駒を配置する関数 */
    placePieceAt: (
        square: Square,
        piece: { owner: Player; type: PieceType; promoted?: boolean } | null,
        options?: { fromSquare?: Square },
    ) => boolean;
    /** 手の処理中フラグのref */
    moveProcessingRef: MutableRefObject<boolean>;
}

/**
 * useMoveExecution の返り値
 */
interface UseMoveExecutionReturn {
    /** マス選択のメインハンドラ */
    handleSquareSelect: (square: string, shiftKey?: boolean) => Promise<void>;
    /** 成り選択ハンドラ */
    handlePromotionChoice: (promote: boolean) => void;
    /** 持ち駒選択ハンドラ */
    handleHandSelect: (piece: PieceType) => void;
    /** USI形式の指し手を現在局面に適用する */
    applyUsiMove: (usiMove: string) => Promise<boolean>;
}

/**
 * 指し手実行を管理するカスタムフック
 *
 * マス選択、成り選択、持ち駒選択などの指し手操作を提供します。
 * - 編集モード、検討モード、対局モードに対応
 * - 合法手チェックと適用
 * - 分岐作成（検討モード）
 */
export function useMoveExecution({
    position,
    navigation,
    isEditMode,
    isReviewMode,
    isPaused,
    positionReady,
    fetchLegalMoves,
    startSfen,
    moves,
    legalCache,
    clearLegalCache,
    setCanPassLegal,
    getPassRightsOption,
    updateClocksForNextTurn,
    turnStartTimeRef,
    isEngineTurn,
    selection,
    setSelection,
    promotionSelection,
    setPromotionSelection,
    setLastMove,
    setMessage,
    setLastAddedBranchInfo,
    editFromSquare,
    setEditFromSquare,
    editTool,
    editPieceType,
    editOwner,
    editPromoted,
    placePieceAt,
    moveProcessingRef,
}: UseMoveExecutionProps): UseMoveExecutionReturn {
    // 合法手セットを取得
    const getLegalSet = async (): Promise<Set<string> | null> => {
        if (!positionReady) return null;
        const ply = moves.length;
        const movesKey = moves.join(" ");
        const passRightsOption = getPassRightsOption();
        const resolver = async () => {
            if (fetchLegalMoves) {
                return fetchLegalMoves(startSfen, moves, passRightsOption);
            }
            return getPositionService().getLegalMoves(startSfen, moves, passRightsOption);
        };
        const result = await legalCache.getOrResolve(movesKey, resolver);
        if (moves.length === ply) {
            setCanPassLegal(result.has("pass"));
        }
        return result;
    };

    // 対局モードで手を適用する
    const applyMoveCommon = (nextPosition: PositionState, mv: string, last?: LastMove) => {
        // 消費時間を計算
        const elapsedMs = Date.now() - turnStartTimeRef.current;
        // 棋譜ナビゲーションに手を追加（局面更新はonPositionChangeで自動実行）
        navigation.addMove(mv, nextPosition, { elapsedMs });
        setLastMove(last);
        setSelection(null);
        setMessage(null);
        clearLegalCache();
        // ターン開始時刻をリセット
        turnStartTimeRef.current = Date.now();
        updateClocksForNextTurn(nextPosition.turn);
    };

    // 検討モードで手を適用（分岐作成、時計更新なし）
    const applyMoveForReview = (nextPosition: PositionState, mv: string, last?: LastMove) => {
        // 現在のノードの子を確認して、分岐が作成されるか判定
        const tree = navigation.tree;
        const currentNode = tree ? tree.nodes.get(tree.currentNodeId) : null;

        const existingChild = currentNode?.children.find((childId: string) => {
            const child = tree?.nodes.get(childId);
            return child?.usiMove === mv;
        });
        const willCreateBranch = !existingChild && (currentNode?.children.length ?? 0) > 0;

        // 棋譜ナビゲーションに手を追加
        navigation.addMove(mv, nextPosition);
        setLastMove(last);
        setSelection(null);
        setMessage(null);
        clearLegalCache();

        // 分岐が作成された場合は記録（ネスト分岐も含む）
        if (willCreateBranch && currentNode) {
            // 分岐点のply（currentNode）と最初の手（mv）を記録
            setLastAddedBranchInfo({ ply: currentNode.ply, firstMove: mv });
        }
    };

    // 編集モードでのマス選択処理
    const handleSquareSelectEditMode = (square: string): boolean => {
        if (!isEditMode || !positionReady) {
            return false;
        }
        const sq = square as Square;

        // 移動元が選択されている場合：移動先として処理
        if (editFromSquare) {
            const from = editFromSquare;
            if (from === sq) {
                // 同じマスをクリック：選択解除
                setEditFromSquare(null);
                return true;
            }
            const moving = position.board[from];
            if (!moving) {
                setEditFromSquare(null);
                return true;
            }
            const ok = placePieceAt(sq, moving, { fromSquare: from });
            if (ok) {
                setEditFromSquare(null);
            }
            return true;
        }

        // 削除モード：駒を削除
        if (editTool === "erase") {
            placePieceAt(sq, null);
            return true;
        }

        // 駒ボタンが選択されている場合：配置
        if (editPieceType) {
            const pieceToPlace = {
                owner: editOwner,
                type: editPieceType,
                promoted: editPromoted || undefined,
            };
            placePieceAt(sq, pieceToPlace);
            return true;
        }

        // 駒ボタン未選択：盤上の駒をクリックで移動元として選択
        const current = position.board[sq];
        if (current) {
            setEditFromSquare(sq);
            return true;
        }

        // 空マスをクリックした場合は何もしない
        return true;
    };

    // 検討モードでのマス選択処理
    const handleSquareSelectReviewMode = async (
        square: string,
        shiftKey?: boolean,
    ): Promise<boolean> => {
        if (!isReviewMode || !positionReady) {
            return false;
        }

        // 成り選択中の場合：キャンセル
        if (promotionSelection) {
            setPromotionSelection(null);
            setSelection(null);
            return true;
        }

        const sq = square as Square;

        // 駒を選択
        if (!selection) {
            const piece = position.board[sq];
            // 検討モードでは現在の手番の駒のみ動かせる
            if (piece && piece.owner === position.turn) {
                setSelection({ kind: "square", square: sq });
            }
            return true;
        }

        // 持ち駒を打つ
        if (selection.kind === "hand") {
            const moveStr = `${selection.piece}*${square}`;
            const legal = await getLegalSet();
            if (legal && !legal.has(moveStr)) {
                setMessage({ text: "合法手ではありません", type: "error" });
                return true;
            }
            const result = applyMoveWithState(position, moveStr, { validateTurn: false });
            if (!result.ok) {
                setMessage({
                    text: result.error ?? "持ち駒を打てませんでした",
                    type: "error",
                });
                return true;
            }
            applyMoveForReview(result.next, moveStr, result.lastMove);
            return true;
        }

        // 盤上の駒を移動
        if (selection.kind === "square") {
            if (selection.square === square) {
                setSelection(null);
                return true;
            }

            const legal = await getLegalSet();
            if (!legal) return true;

            const from = selection.square;
            const to = square;
            const piece = position.board[from as Square];

            const promotion = determinePromotion(legal, from, to);

            if (promotion === "none") {
                const moveStr = `${from}${to}`;
                if (!legal.has(moveStr)) {
                    setMessage({ text: "合法手ではありません", type: "error" });
                    return true;
                }
                const result = applyMoveWithState(position, moveStr, {
                    validateTurn: false,
                });
                if (!result.ok) {
                    setMessage({
                        text: result.error ?? "指し手を適用できませんでした",
                        type: "error",
                    });
                    return true;
                }
                applyMoveForReview(result.next, moveStr, result.lastMove);
                return true;
            }

            if (promotion === "forced") {
                const moveStr = `${from}${to}+`;
                const result = applyMoveWithState(position, moveStr, {
                    validateTurn: false,
                });
                if (!result.ok) {
                    setMessage({
                        text: result.error ?? "指し手を適用できませんでした",
                        type: "error",
                    });
                    return true;
                }
                applyMoveForReview(result.next, moveStr, result.lastMove);
                return true;
            }

            // 任意成り: Shift+クリック
            if (shiftKey) {
                const moveStr = `${from}${to}+`;
                const result = applyMoveWithState(position, moveStr, {
                    validateTurn: false,
                });
                if (!result.ok) {
                    setMessage({
                        text: result.error ?? "指し手を適用できませんでした",
                        type: "error",
                    });
                    return true;
                }
                applyMoveForReview(result.next, moveStr, result.lastMove);
                return true;
            }

            if (!piece) {
                setMessage({ text: "駒が見つかりません", type: "error" });
                return true;
            }
            setPromotionSelection({ from: from as Square, to: to as Square, piece });
            return true;
        }
        return true;
    };

    // 対局モードでのマス選択処理
    const handleSquareSelectGameMode = async (
        square: string,
        shiftKey?: boolean,
    ): Promise<boolean> => {
        // 待った・パス処理中は入力をブロック
        if (moveProcessingRef.current) {
            return true;
        }
        // 一時停止中は入力をブロック
        if (isPaused) {
            return true;
        }
        if (!positionReady) {
            return true;
        }
        if (isEngineTurn(position.turn)) {
            return true;
        }

        // 成り選択中の場合：成り/不成を選択
        if (promotionSelection) {
            // 成り選択UIの外をクリック → キャンセル
            setPromotionSelection(null);
            setSelection(null);
            return true;
        }

        if (!selection) {
            const sq = square as Square;
            const piece = position.board[sq];
            if (piece && piece.owner === position.turn) {
                setSelection({ kind: "square", square: sq });
            }
            return true;
        }

        if (selection.kind === "square") {
            if (selection.square === square) {
                setSelection(null);
                return true;
            }

            const legal = await getLegalSet();
            if (!legal) return true;

            const from = selection.square;
            const to = square;
            const piece = position.board[from as Square];

            // 成り判定を実行
            const promotion = determinePromotion(legal, from, to);

            // 【ケース1】成れない場合 → 基本移動を試行
            if (promotion === "none") {
                const moveStr = `${from}${to}`;
                if (!legal.has(moveStr)) {
                    setMessage({ text: "合法手ではありません", type: "error" });
                    return true;
                }
                const result = applyMoveWithState(position, moveStr, { validateTurn: true });
                if (!result.ok) {
                    setMessage({
                        text: result.error ?? "指し手を適用できませんでした",
                        type: "error",
                    });
                    return true;
                }
                applyMoveCommon(result.next, moveStr, result.lastMove);
                return true;
            }

            // 【ケース2】強制成り → 自動的に成って移動（ダイアログなし）
            if (promotion === "forced") {
                const moveStr = `${from}${to}+`;
                const result = applyMoveWithState(position, moveStr, { validateTurn: true });
                if (!result.ok) {
                    setMessage({
                        text: result.error ?? "指し手を適用できませんでした",
                        type: "error",
                    });
                    return true;
                }
                applyMoveCommon(result.next, moveStr, result.lastMove);
                return true;
            }

            // 【ケース3】任意成り（promotion === 'optional'）
            // Shift+クリック：即座に成って移動
            if (shiftKey) {
                const moveStr = `${from}${to}+`;
                const result = applyMoveWithState(position, moveStr, { validateTurn: true });
                if (!result.ok) {
                    setMessage({
                        text: result.error ?? "指し手を適用できませんでした",
                        type: "error",
                    });
                    return true;
                }
                applyMoveCommon(result.next, moveStr, result.lastMove);
                return true;
            }

            // 通常クリック：成り選択ダイアログを表示
            if (!piece) {
                setMessage({ text: "駒が見つかりません", type: "error" });
                return true;
            }
            setPromotionSelection({ from: from as Square, to: to as Square, piece });
            return true;
        }

        // 持ち駒を打つ
        const moveStr = `${selection.piece}*${square}`;
        const legal = await getLegalSet();
        if (legal && !legal.has(moveStr)) {
            setMessage({ text: "合法手ではありません", type: "error" });
            return true;
        }
        const result = applyMoveWithState(position, moveStr, { validateTurn: true });
        if (!result.ok) {
            setMessage({ text: result.error ?? "持ち駒を打てませんでした", type: "error" });
            return true;
        }
        applyMoveCommon(result.next, moveStr, result.lastMove);
        return true;
    };

    // マス選択のメインハンドラ
    const handleSquareSelect = async (square: string, shiftKey?: boolean) => {
        setMessage(null);

        // 編集モード
        if (isEditMode) {
            handleSquareSelectEditMode(square);
            return;
        }

        // 検討モード
        if (isReviewMode) {
            await handleSquareSelectReviewMode(square, shiftKey);
            return;
        }

        // 対局モード
        await handleSquareSelectGameMode(square, shiftKey);
    };

    // 成り選択ハンドラ
    const handlePromotionChoice = (promote: boolean) => {
        if (!promotionSelection) return;
        const { from, to } = promotionSelection;
        const moveStr = `${from}${to}${promote ? "+" : ""}`;
        // 検討モードでは手番チェックをスキップ
        const result = applyMoveWithState(position, moveStr, { validateTurn: !isReviewMode });
        if (!result.ok) {
            setMessage({ text: result.error ?? "指し手を適用できませんでした", type: "error" });
            setPromotionSelection(null);
            setSelection(null);
            return;
        }
        if (isReviewMode) {
            applyMoveForReview(result.next, moveStr, result.lastMove);
        } else {
            applyMoveCommon(result.next, moveStr, result.lastMove);
        }
        setPromotionSelection(null);
    };

    // 持ち駒選択ハンドラ
    const handleHandSelect = (piece: PieceType) => {
        if (!positionReady) {
            return;
        }
        if (isEditMode) {
            return;
        }
        // 検討モードでは手番の持ち駒を選択可能
        if (!isReviewMode && isEngineTurn(position.turn)) {
            return;
        }
        setSelection({ kind: "hand", piece });
        setMessage(null);
    };

    const applyUsiMove = async (usiMove: string): Promise<boolean> => {
        setMessage(null);

        if (!positionReady || isEditMode) {
            return false;
        }

        if (moveProcessingRef.current) {
            return false;
        }

        if (!isReviewMode) {
            if (isPaused) {
                return false;
            }
            if (isEngineTurn(position.turn)) {
                return false;
            }
        }

        const result = applyMoveWithState(position, usiMove, { validateTurn: !isReviewMode });
        if (!result.ok) {
            setMessage({
                text: result.error ?? "指し手を適用できませんでした",
                type: "error",
            });
            return false;
        }

        if (isReviewMode) {
            applyMoveForReview(result.next, usiMove, result.lastMove);
        } else {
            applyMoveCommon(result.next, usiMove, result.lastMove);
        }

        setPromotionSelection(null);
        return true;
    };

    return {
        handleSquareSelect,
        handlePromotionChoice,
        handleHandSelect,
        applyUsiMove,
    };
}
