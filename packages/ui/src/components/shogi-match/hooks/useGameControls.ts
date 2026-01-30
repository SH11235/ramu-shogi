import {
    cloneBoard,
    type GameResult,
    getPositionService,
    type NnueSelection,
    type PieceType,
    type Player,
    type PositionState,
    type ResolvedNnue,
    type Square,
} from "@shogi/app-core";
import type { MutableRefObject } from "react";
import { useCallback } from "react";
import type { Message, PassRightsSettings } from "../types";
import { cloneHandsState } from "../utils/boardUtils";
import type { UseKifuNavigationResult } from "./useKifuNavigation";

/** PositionState を深くコピーする */
const clonePositionState = (pos: PositionState): PositionState => ({
    board: cloneBoard(pos.board),
    hands: cloneHandsState(pos.hands),
    turn: pos.turn,
    ply: pos.ply,
    passRights: pos.passRights
        ? { sente: pos.passRights.sente, gote: pos.passRights.gote }
        : undefined,
});

/**
 * useGameControls の props
 */
export interface UseGameControlsProps {
    /** 局面状態 */
    position: PositionState;
    /** 局面状態の ref */
    positionRef: MutableRefObject<PositionState>;
    /** 棋譜ナビゲーション */
    navigation: UseKifuNavigationResult;
    /** 対局中かどうか */
    isMatchRunning: boolean;
    /** 一時停止中かどうか */
    isPaused: boolean;
    /** 編集モードかどうか */
    isEditMode: boolean;
    /** 局面準備完了かどうか */
    positionReady: boolean;
    /** 開始局面のSFEN */
    startSfen: string;
    /** パス権設定 */
    passRightsSettings: PassRightsSettings;
    /** 対局者設定 */
    sides: { sente: { role: string }; gote: { role: string } };
    /** 先手NNUE選択 */
    senteNnueSelection: NnueSelection;
    /** 後手NNUE選択 */
    goteNnueSelection: NnueSelection;
    /** 対局終了フラグの ref */
    matchEndedRef: MutableRefObject<boolean>;
    /** ターン開始時刻の ref */
    turnStartTimeRef: MutableRefObject<number>;
    /** 時計を停止する */
    stopTicking: () => void;
    /** 時計を開始する */
    startTicking: (side: Player) => void;
    /** 時計をリセットする */
    resetClocks: (startTicking: boolean) => void;
    /** 全エンジンを停止する */
    stopAllEngines: () => Promise<void>;
    /** NNUEを解決する */
    resolveNnue: (selection: NnueSelection) => Promise<ResolvedNnue | null>;
    /** 合法手キャッシュをクリアする */
    clearLegalCache: () => void;
    /** SFENを更新する */
    refreshStartSfen: (pos: PositionState) => Promise<string>;
    /** 対局中フラグを設定する */
    setIsMatchRunning: (value: boolean) => void;
    /** 一時停止フラグを設定する */
    setIsPaused: (value: boolean) => void;
    /** 編集モードを設定する */
    setIsEditMode: (value: boolean) => void;
    /** 局面を設定する */
    setPosition: (position: PositionState) => void;
    /** 基準局面を設定する */
    setBasePosition: (position: PositionState) => void;
    /** 初期盤面を設定する */
    setInitialBoard: (board: PositionState["board"]) => void;
    /** 開始局面のSFENを設定する */
    setStartSfen: (sfen: string) => void;
    /** 局面準備完了を設定する */
    setPositionReady: (ready: boolean) => void;
    /** 最後の手を設定する */
    setLastMove: (lastMove: undefined) => void;
    /** 選択を解除する */
    setSelection: (selection: null) => void;
    /** メッセージを設定する */
    setMessage: (message: Message | null) => void;
    /** 最後に追加された分岐情報を設定する */
    setLastAddedBranchInfo: (info: null) => void;
    /** 勝敗結果を設定する */
    setGameResult: (result: GameResult | null) => void;
    /** 勝敗ダイアログ表示を設定する */
    setShowResultDialog: (show: boolean) => void;
    /** NNUE管理ダイアログを開く */
    openNnueManager: (reason?: string) => void;
    /** 編集モードの移動元マスを設定する */
    setEditFromSquare: (square: Square | null) => void;
    /** 編集ツールを設定する */
    setEditTool: (tool: "place" | "erase") => void;
    /** 編集駒の成り状態を設定する */
    setEditPromoted: (promoted: boolean) => void;
    /** 編集駒の所有者を設定する */
    setEditOwner: (owner: Player) => void;
    /** 編集駒の種類を設定する */
    setEditPieceType: (pieceType: PieceType | null) => void;
}

/**
 * useGameControls の返り値
 */
export interface UseGameControlsReturn {
    /** 対局を一時停止する */
    pauseAutoPlay: () => Promise<void>;
    /** 一時停止中から編集モードに移行する */
    enterEditModeFromPaused: () => void;
    /** 対局を開始/再開する */
    resumeAutoPlay: () => Promise<void>;
    /** 検討モードを開始する */
    handleStartReview: () => Promise<void>;
    /** 編集済み局面を確定する */
    finalizeEditedPosition: () => Promise<void>;
    /** 検討モードから編集モードに移行する */
    handleEnterEditMode: () => Promise<void>;
    /** 平手初期局面にリセットする */
    handleResetToStartpos: () => Promise<void>;
}

/**
 * 対局制御を管理するカスタムフック
 *
 * 対局状態遷移（editing → playing → paused → reviewing）を制御する
 */
export function useGameControls({
    position,
    positionRef,
    navigation,
    isMatchRunning,
    isPaused,
    isEditMode,
    positionReady,
    startSfen,
    passRightsSettings,
    sides,
    senteNnueSelection,
    goteNnueSelection,
    matchEndedRef,
    turnStartTimeRef,
    stopTicking,
    startTicking,
    resetClocks,
    stopAllEngines,
    resolveNnue,
    clearLegalCache,
    refreshStartSfen,
    setIsMatchRunning,
    setIsPaused,
    setIsEditMode,
    setPosition,
    setBasePosition,
    setInitialBoard,
    setStartSfen,
    setPositionReady,
    setLastMove,
    setSelection,
    setMessage,
    setLastAddedBranchInfo,
    setGameResult,
    setShowResultDialog,
    openNnueManager,
    setEditFromSquare,
    setEditTool,
    setEditPromoted,
    setEditOwner,
    setEditPieceType,
}: UseGameControlsProps): UseGameControlsReturn {
    /**
     * 編集済み局面を確定する
     */
    const finalizeEditedPosition = useCallback(async () => {
        if (isMatchRunning) return;
        const current = positionRef.current;
        setBasePosition(clonePositionState(current));
        setInitialBoard(cloneBoard(current.board));
        // SFENを取得して棋譜ツリーをリセット（編集した持ち駒情報を反映）
        try {
            const newSfen = await refreshStartSfen(current);
            navigation.reset(current, newSfen);
            clearLegalCache();
            setIsEditMode(false);
        } catch {
            setMessage({ text: "局面の確定に失敗しました。", type: "error" });
        }
    }, [
        isMatchRunning,
        positionRef,
        navigation,
        clearLegalCache,
        refreshStartSfen,
        setBasePosition,
        setInitialBoard,
        setIsEditMode,
        setMessage,
    ]);

    /**
     * 対局を一時停止する
     */
    const pauseAutoPlay = useCallback(async () => {
        setIsMatchRunning(false);
        setIsPaused(true);
        stopTicking();
        await stopAllEngines();
    }, [setIsMatchRunning, setIsPaused, stopTicking, stopAllEngines]);

    /**
     * 一時停止中から編集モードに移行する
     */
    const enterEditModeFromPaused = useCallback(() => {
        setIsPaused(false);
        setIsEditMode(true);
    }, [setIsPaused, setIsEditMode]);

    /**
     * 対局を開始/再開する
     */
    const resumeAutoPlay = useCallback(async () => {
        matchEndedRef.current = false;
        if (!positionReady) return;

        // 一時停止からの再開：棋譜を保持したまま再開
        if (isPaused) {
            setIsPaused(false);
            setIsMatchRunning(true);
            turnStartTimeRef.current = Date.now();
            startTicking(position.turn);
            return;
        }

        // 編集モードからの再開：棋譜をリセットして新しい対局を開始
        if (isEditMode) {
            await finalizeEditedPosition();
            setIsEditMode(false);
        }

        // パス権が有効な場合、対局開始時に初期化
        // ナビゲーションのルートノードにもパス権を反映するため、navigation.resetを呼び直す
        if (passRightsSettings?.enabled && !positionRef.current.passRights) {
            const updatedPosition = {
                ...positionRef.current,
                passRights: {
                    sente: passRightsSettings.senteInitialCount,
                    gote: passRightsSettings.goteInitialCount,
                },
            };
            setPosition(updatedPosition);
            positionRef.current = updatedPosition;
            // ナビゲーションのルートノードをパス権付きの局面で更新
            navigation.reset(updatedPosition, startSfen);
        }

        // 対局開始前に NNUE の存在確認を行う（未ダウンロードの場合はエラー）
        try {
            const nnuePreparations: Promise<unknown>[] = [];
            if (sides.sente.role === "engine" && senteNnueSelection) {
                nnuePreparations.push(resolveNnue(senteNnueSelection));
            }
            if (sides.gote.role === "engine" && goteNnueSelection) {
                nnuePreparations.push(resolveNnue(goteNnueSelection));
            }
            if (nnuePreparations.length > 0) {
                await Promise.all(nnuePreparations);
            }
        } catch (e) {
            // NNUE未ダウンロードエラー → 評価関数ファイル管理を開いて理由を表示
            const errorMessage = e instanceof Error ? e.message : "評価関数の準備に失敗しました";
            openNnueManager(`対局を開始できません: ${errorMessage}`);
            return;
        }

        // エンジン管理は useEngineManager フックが自動的に処理する
        setIsMatchRunning(true);
        turnStartTimeRef.current = Date.now();
        startTicking(position.turn);
    }, [
        matchEndedRef,
        positionReady,
        isPaused,
        isEditMode,
        passRightsSettings,
        positionRef,
        position.turn,
        startSfen,
        sides,
        senteNnueSelection,
        goteNnueSelection,
        navigation,
        turnStartTimeRef,
        finalizeEditedPosition,
        resolveNnue,
        startTicking,
        setIsPaused,
        setIsMatchRunning,
        setIsEditMode,
        setPosition,
        openNnueManager,
    ]);

    /**
     * 検討モードを開始する
     */
    const handleStartReview = useCallback(async () => {
        if (!positionReady) return;
        if (isEditMode) {
            await finalizeEditedPosition();
            setIsEditMode(false);
        }
        // isMatchRunningはfalseのままでisReviewModeになる
    }, [positionReady, isEditMode, finalizeEditedPosition, setIsEditMode]);

    /**
     * 検討モードから編集モードに移行する
     */
    const handleEnterEditMode = useCallback(async () => {
        if (isMatchRunning) return;
        const current = positionRef.current;
        // 現在局面を編集開始局面として設定
        setBasePosition(clonePositionState(current));
        setInitialBoard(cloneBoard(current.board));
        // 先にSFENを取得してから棋譜ナビゲーションをリセット
        try {
            const newSfen = await refreshStartSfen(current);
            navigation.reset(current, newSfen);
            setLastMove(undefined);
            setSelection(null);
            setMessage(null);
            setLastAddedBranchInfo(null);
            clearLegalCache();
            // 編集モードに移行
            setIsEditMode(true);
        } catch {
            setMessage({ text: "編集モードへの移行に失敗しました。", type: "error" });
        }
    }, [
        isMatchRunning,
        positionRef,
        navigation,
        clearLegalCache,
        refreshStartSfen,
        setBasePosition,
        setInitialBoard,
        setLastMove,
        setSelection,
        setMessage,
        setLastAddedBranchInfo,
        setIsEditMode,
    ]);

    /**
     * 平手初期局面にリセットする
     */
    const handleResetToStartpos = useCallback(async () => {
        matchEndedRef.current = false;
        setGameResult(null);
        setShowResultDialog(false);
        await stopAllEngines();

        const service = getPositionService();
        try {
            const pos = await service.getInitialBoard();
            const next = clonePositionState(pos);
            setPosition(next);
            positionRef.current = next;
            setInitialBoard(cloneBoard(next.board));
            setBasePosition(clonePositionState(next));
            setStartSfen("startpos");
            setPositionReady(true);

            navigation.reset(next, "startpos");
            setLastMove(undefined);
            setSelection(null);
            setMessage(null);
            setLastAddedBranchInfo(null);
            resetClocks(false);

            setIsMatchRunning(false);
            setIsEditMode(true);
            setEditFromSquare(null);
            setEditTool("place");
            setEditPromoted(false);
            setEditOwner("sente");
            setEditPieceType(null);
            clearLegalCache();
            turnStartTimeRef.current = Date.now();
        } catch (error) {
            setMessage({ text: `平手初期化に失敗しました: ${String(error)}`, type: "error" });
        }
    }, [
        matchEndedRef,
        positionRef,
        turnStartTimeRef,
        navigation,
        stopAllEngines,
        resetClocks,
        clearLegalCache,
        setGameResult,
        setShowResultDialog,
        setPosition,
        setInitialBoard,
        setBasePosition,
        setStartSfen,
        setPositionReady,
        setLastMove,
        setSelection,
        setMessage,
        setLastAddedBranchInfo,
        setIsMatchRunning,
        setIsEditMode,
        setEditFromSquare,
        setEditTool,
        setEditPromoted,
        setEditOwner,
        setEditPieceType,
    ]);

    return {
        pauseAutoPlay,
        enterEditModeFromPaused,
        resumeAutoPlay,
        handleStartReview,
        finalizeEditedPosition,
        handleEnterEditMode,
        handleResetToStartpos,
    };
}
