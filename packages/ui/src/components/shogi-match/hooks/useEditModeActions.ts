import {
    cloneBoard,
    type Piece,
    type PieceType,
    type Player,
    type PositionState,
    type Square,
} from "@shogi/app-core";
import type { MutableRefObject } from "react";
import type { Message } from "../types";
import { addToHand, cloneHandsState, consumeFromHand, countPieces } from "../utils/boardUtils";
import { isPromotable, PIECE_CAP, PIECE_LABELS } from "../utils/constants";
import type { UseKifuNavigationResult } from "./useKifuNavigation";

/**
 * useEditModeActions の props
 */
interface UseEditModeActionsProps {
    /** 局面状態 */
    position: PositionState;
    /** 局面状態の ref */
    positionRef: MutableRefObject<PositionState>;
    /** 編集バージョンの ref */
    editVersionRef: MutableRefObject<number>;
    /** 棋譜ナビゲーション */
    navigation: UseKifuNavigationResult;
    /** 編集モードかどうか */
    isEditMode: boolean;
    /** 対局中かどうか */
    isMatchRunning: boolean;
    /** 対局終了フラグの ref */
    matchEndedRef: MutableRefObject<boolean>;
    /** 合法手キャッシュをクリアする */
    clearLegalCache: () => void;
    /** 時計を停止する */
    stopTicking: () => void;
    /** SFENを更新する */
    refreshStartSfen: (pos: PositionState) => Promise<string>;
    /** 局面を設定する */
    setPosition: (position: PositionState) => void;
    /** 初期盤面を設定する */
    setInitialBoard: (board: PositionState["board"]) => void;
    /** 最後の手を設定する */
    setLastMove: (lastMove: undefined) => void;
    /** 選択を解除する */
    setSelection: (selection: null) => void;
    /** メッセージを設定する */
    setMessage: (message: Message | null) => void;
    /** 最後に追加された分岐情報を設定する */
    setLastAddedBranchInfo: (info: null) => void;
    /** 編集モードの移動元マスを設定する */
    setEditFromSquare: (square: Square | null) => void;
    /** 対局中フラグを設定する */
    setIsMatchRunning: (value: boolean) => void;
}

/**
 * useEditModeActions の返り値
 */
interface UseEditModeActionsReturn {
    /** 編集後の局面を適用する */
    applyEditedPosition: (nextPosition: PositionState) => Promise<void>;
    /** 駒の成りを設定する */
    setPiecePromotion: (square: Square, promote: boolean) => void;
    /** 駒を配置する */
    placePieceAt: (
        square: Square,
        piece: Piece | null,
        options?: { fromSquare?: Square },
    ) => boolean;
    /** 持ち駒を増やす */
    handleIncrementHand: (owner: Player, pieceType: PieceType) => void;
    /** 持ち駒を減らす */
    handleDecrementHand: (owner: Player, pieceType: PieceType) => void;
}

/**
 * 編集モードのアクションを管理するカスタムフック
 *
 * - 局面の適用
 * - 駒の成り設定
 * - 駒の配置
 * - 持ち駒の増減
 */
export function useEditModeActions({
    position,
    positionRef,
    editVersionRef,
    navigation,
    isEditMode,
    isMatchRunning,
    matchEndedRef,
    clearLegalCache,
    stopTicking,
    refreshStartSfen,
    setPosition,
    setInitialBoard,
    setLastMove,
    setSelection,
    setMessage,
    setLastAddedBranchInfo,
    setEditFromSquare,
    setIsMatchRunning,
}: UseEditModeActionsProps): UseEditModeActionsReturn {
    /**
     * 編集後の局面を適用する
     */
    const applyEditedPosition = async (nextPosition: PositionState) => {
        // バージョンをインクリメントして現在の操作IDを取得
        editVersionRef.current += 1;
        const currentVersion = editVersionRef.current;

        setPosition(nextPosition);
        positionRef.current = nextPosition;
        setInitialBoard(cloneBoard(nextPosition.board));

        // 先にSFENを取得してから棋譜ナビゲーションをリセット
        try {
            const newSfen = await refreshStartSfen(nextPosition);

            // 古い操作の結果は無視（より新しい編集が既に開始されている場合）
            if (editVersionRef.current !== currentVersion) {
                return;
            }

            navigation.reset(nextPosition, newSfen);

            setLastMove(undefined);
            setSelection(null);
            setMessage(null);
            setLastAddedBranchInfo(null);
            setEditFromSquare(null);

            clearLegalCache();
            stopTicking();
            matchEndedRef.current = false;
            setIsMatchRunning(false);
        } catch {
            // 古い操作のエラーは無視
            if (editVersionRef.current !== currentVersion) {
                return;
            }
            setMessage({ text: "局面の適用に失敗しました。", type: "error" });
        }
    };

    /**
     * 駒の成りを設定する
     */
    const setPiecePromotion = (square: Square, promote: boolean) => {
        if (!isEditMode) return;
        const current = positionRef.current;
        const piece = current.board[square];
        if (!piece) return;
        if (!isPromotable(piece.type)) {
            setMessage({ text: `${PIECE_LABELS[piece.type]}は成れません。`, type: "error" });
            return;
        }

        const nextBoard = cloneBoard(current.board);
        nextBoard[square] = promote
            ? { ...piece, promoted: true }
            : { ...piece, promoted: undefined };
        void applyEditedPosition({ ...current, board: nextBoard });
    };

    /**
     * 駒を配置する
     */
    const placePieceAt = (
        square: Square,
        piece: Piece | null,
        options?: { fromSquare?: Square },
    ): boolean => {
        const current = positionRef.current;
        const nextBoard = cloneBoard(current.board);
        let workingHands = cloneHandsState(current.hands);

        if (options?.fromSquare) {
            nextBoard[options.fromSquare] = null;
        }

        const existing = nextBoard[square];
        if (existing) {
            const base = existing.type;
            workingHands = addToHand(workingHands, existing.owner, base);
        }

        if (!piece) {
            nextBoard[square] = null;
            const nextPosition: PositionState = {
                ...current,
                board: nextBoard,
                hands: workingHands,
            };
            void applyEditedPosition(nextPosition);
            return true;
        }

        const baseType = piece.type;
        const consumedHands = consumeFromHand(workingHands, piece.owner, baseType);
        const handsForPlacement = consumedHands ?? workingHands;
        const countsBefore = countPieces({
            ...current,
            board: nextBoard,
            hands: handsForPlacement,
        });
        const nextCount = countsBefore[piece.owner][baseType] + 1;
        if (nextCount > PIECE_CAP[baseType]) {
            setMessage({
                text: `${piece.owner === "sente" ? "先手" : "後手"}の${PIECE_LABELS[baseType]}は最大${PIECE_CAP[baseType]}枚までです`,
                type: "warning",
            });
            return false;
        }
        if (piece.type === "K" && countsBefore[piece.owner][baseType] >= PIECE_CAP.K) {
            setMessage({ text: "玉はそれぞれ1枚まで配置できます。", type: "warning" });
            return false;
        }

        nextBoard[square] = piece.promoted ? { ...piece, promoted: true } : { ...piece };
        const finalHands = consumedHands ?? workingHands;
        const nextPosition: PositionState = {
            ...current,
            board: nextBoard,
            hands: finalHands,
        };
        void applyEditedPosition(nextPosition);
        return true;
    };

    /**
     * 持ち駒を増やす
     */
    const handleIncrementHand = (owner: Player, pieceType: PieceType) => {
        if (isMatchRunning || !position) return;
        const counts = countPieces(position);
        const currentCount = counts[owner][pieceType];
        if (currentCount >= PIECE_CAP[pieceType]) return;

        const nextHands = addToHand(cloneHandsState(position.hands), owner, pieceType);
        const nextPosition = {
            ...position,
            hands: nextHands,
        };
        setPosition(nextPosition);
        positionRef.current = nextPosition;
    };

    /**
     * 持ち駒を減らす
     */
    const handleDecrementHand = (owner: Player, pieceType: PieceType) => {
        if (isMatchRunning || !position) return;
        const count = position.hands[owner][pieceType] ?? 0;
        if (count <= 0) return;

        const nextHands = consumeFromHand(cloneHandsState(position.hands), owner, pieceType);
        if (nextHands) {
            const nextPosition = {
                ...position,
                hands: nextHands,
            };
            setPosition(nextPosition);
            positionRef.current = nextPosition;
        }
    };

    return {
        applyEditedPosition,
        setPiecePromotion,
        placePieceAt,
        handleIncrementHand,
        handleDecrementHand,
    };
}
