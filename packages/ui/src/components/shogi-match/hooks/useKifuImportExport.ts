import type { BoardState, LastMove, PositionState } from "@shogi/app-core";
import {
    applyMoveWithState,
    cloneBoard,
    deriveLastMove,
    getPositionService,
} from "@shogi/app-core";
import { useCallback } from "react";
import type { Message, PassRightsSettings, SideSetting } from "../types";
import type { KifMove } from "../utils/kifFormat";
import { exportToKifString } from "../utils/kifFormat";
import type { KifMoveData } from "../utils/kifParser";
import { parseSfen } from "../utils/kifParser";
import { buildPassRightsOptionForLegalMoves } from "../utils/passRightsSettings";
import type { UseKifuNavigationResult } from "./useKifuNavigation";

/**
 * useKifuImportExport の props
 */
interface UseKifuImportExportProps {
    /** 棋譜ナビゲーション */
    navigation: UseKifuNavigationResult;
    /** パス権設定 */
    passRightsSettings: PassRightsSettings;
    /** 合法手キャッシュをクリアする */
    clearLegalCache: () => void;
    /** 時計をリセットする */
    resetClocks: (startTicking: boolean) => void;
    /** 棋譜の指し手データ */
    kifMoves: KifMove[];
    /** 棋譜の盤面履歴 */
    boardHistory: BoardState[];
    /** 対局者設定 */
    sides: { sente: SideSetting; gote: SideSetting };
    /** 開始局面のSFEN */
    startSfen: string;
    /** 最後の手を設定する */
    setLastMove: (lastMove: LastMove | undefined) => void;
    /** 選択を解除する */
    setSelection: (selection: null) => void;
    /** メッセージを設定する */
    setMessage: (message: Message | null) => void;
    /** 局面準備完了を設定する */
    setPositionReady: (ready: boolean) => void;
    /** 開始局面を設定する */
    setBasePosition: (position: PositionState) => void;
    /** 開始局面のSFENを設定する */
    setStartSfen: (sfen: string) => void;
    /** 初期盤面を設定する */
    setInitialBoard: (board: BoardState) => void;
    /** 最後に追加された分岐情報を設定する */
    setLastAddedBranchInfo: (info: { ply: number; firstMove: string } | null) => void;
    /** 編集モードを設定する */
    setIsEditMode: (value: boolean) => void;
    /** 対局中フラグを設定する */
    setIsMatchRunning: (value: boolean) => void;
}

/**
 * useKifuImportExport の返り値
 */
interface UseKifuImportExportReturn {
    /** 棋譜を読み込む（内部用） */
    loadMoves: (
        list: string[],
        moveData: KifMoveData[] | undefined,
        startPosition: PositionState,
        startSfenToLoad: string,
    ) => Promise<void>;
    /** KIF形式でコピー */
    handleCopyKif: () => string;
    /** SFENと指し手をインポート */
    importSfen: (sfen: string, movesToLoad: string[]) => Promise<void>;
    /** KIF形式をインポート */
    importKif: (
        movesToLoad: string[],
        moveData: KifMoveData[],
        startSfenFromKif?: string,
    ) => Promise<void>;
}

/**
 * 棋譜のインポート・エクスポートを管理するカスタムフック
 *
 * - KIF形式でのエクスポート
 * - SFEN + 指し手のインポート
 * - KIF形式のインポート
 */
export function useKifuImportExport({
    navigation,
    passRightsSettings,
    clearLegalCache,
    resetClocks,
    kifMoves,
    boardHistory,
    sides,
    startSfen,
    setLastMove,
    setSelection,
    setMessage,
    setPositionReady,
    setBasePosition,
    setStartSfen,
    setInitialBoard,
    setLastAddedBranchInfo,
    setIsEditMode,
    setIsMatchRunning,
}: UseKifuImportExportProps): UseKifuImportExportReturn {
    /**
     * 棋譜を読み込む（内部用）
     */
    const loadMoves = useCallback(
        async (
            list: string[],
            moveData: KifMoveData[] | undefined,
            startPosition: PositionState,
            startSfenToLoad: string,
        ) => {
            const filtered = list.filter(Boolean);
            const service = getPositionService();
            // パス入り棋譜の場合はpassRightsを渡す
            const passRightsOption = buildPassRightsOptionForLegalMoves(
                passRightsSettings,
                filtered,
            );
            const result = await service.replayMovesStrict(
                startSfenToLoad,
                filtered,
                passRightsOption,
            );

            // 棋譜ナビゲーションをリセット
            navigation.reset(startPosition, startSfenToLoad);
            setLastAddedBranchInfo(null); // 分岐状態をクリア

            // 各手を順番に追加
            let currentPos = startPosition;
            for (let i = 0; i < result.applied.length; i++) {
                const move = result.applied[i];
                const data = moveData?.[i];
                const applyResult = applyMoveWithState(currentPos, move, {
                    validateTurn: false,
                });
                if (applyResult.ok) {
                    // 消費時間と評価値を渡す
                    // KIFインポートの評価値は既に先手視点なので normalized: true
                    navigation.addMove(move, applyResult.next, {
                        elapsedMs: data?.elapsedMs,
                        eval:
                            data?.evalCp !== undefined || data?.evalMate !== undefined
                                ? {
                                      scoreCp: data.evalCp,
                                      scoreMate: data.evalMate,
                                      depth: data.depth,
                                      normalized: true,
                                  }
                                : undefined,
                    });
                    currentPos = applyResult.next;
                }
            }

            setLastMove(deriveLastMove(result.applied.at(-1)));
            setSelection(null);
            setMessage(null);
            resetClocks(false);

            clearLegalCache();
            setPositionReady(true);

            if (result.error) {
                throw new Error(result.error);
            }
        },
        [
            clearLegalCache,
            navigation,
            resetClocks,
            passRightsSettings,
            setLastMove,
            setSelection,
            setMessage,
            setPositionReady,
            setLastAddedBranchInfo,
        ],
    );

    /**
     * KIFコピー用コールバック
     */
    const handleCopyKif = useCallback((): string => {
        return exportToKifString(kifMoves, boardHistory, {
            startTime: new Date(),
            senteName: sides.sente.role === "engine" ? "エンジン" : "人間",
            goteName: sides.gote.role === "engine" ? "エンジン" : "人間",
            includeEval: true, // 評価値もコメントとして出力
            startSfen,
        });
    }, [kifMoves, boardHistory, sides.sente.role, sides.gote.role, startSfen]);

    /**
     * SFENインポート（局面 + 指し手）
     * インポート後は自動的に検討モードに入る
     */
    const importSfen = useCallback(
        async (sfen: string, movesToLoad: string[]) => {
            const service = getPositionService();
            try {
                // 新しい開始局面を設定
                const newPosition = await service.parseSfen(sfen);
                setBasePosition(newPosition);
                setStartSfen(sfen);
                setInitialBoard(newPosition.board);

                // 棋譜ナビゲーションをリセット
                navigation.reset(newPosition, sfen);
                setLastAddedBranchInfo(null); // 分岐状態をクリア

                // 指し手がある場合は適用
                if (movesToLoad.length > 0) {
                    let currentPos = newPosition;
                    const appliedMoves: string[] = [];
                    for (const move of movesToLoad) {
                        const applyResult = applyMoveWithState(currentPos, move, {
                            validateTurn: false,
                        });
                        if (applyResult.ok) {
                            navigation.addMove(move, applyResult.next);
                            currentPos = applyResult.next;
                            appliedMoves.push(move);
                        } else {
                            break;
                        }
                    }
                    setLastMove(deriveLastMove(appliedMoves.at(-1)));
                } else {
                    setLastMove(undefined);
                }

                setSelection(null);
                resetClocks(false);
                clearLegalCache();
                setPositionReady(true);

                // インポート後は自動的に検討モードに入る
                setIsEditMode(false);
                setIsMatchRunning(false);
            } catch (error) {
                throw new Error(`SFENの適用に失敗しました: ${String(error)}`);
            }
        },
        [
            clearLegalCache,
            navigation,
            resetClocks,
            setLastMove,
            setSelection,
            setPositionReady,
            setBasePosition,
            setStartSfen,
            setInitialBoard,
            setLastAddedBranchInfo,
            setIsEditMode,
            setIsMatchRunning,
        ],
    );

    /**
     * KIFインポート（開始局面情報があれば使用）
     * インポート後は自動的に検討モードに入る
     */
    const importKif = useCallback(
        async (movesToLoad: string[], moveData: KifMoveData[], startSfenFromKif?: string) => {
            const service = getPositionService();

            let startPosition: PositionState;
            let startSfenToLoad: string;

            if (startSfenFromKif?.trim()) {
                const parsed = parseSfen(startSfenFromKif);
                if (!parsed.sfen) {
                    throw new Error("開始局面のSFENが空です。");
                }
                startSfenToLoad = parsed.sfen;
                try {
                    startPosition = await service.parseSfen(startSfenToLoad);
                } catch (error) {
                    throw new Error(`開始局面の解析に失敗しました: ${String(error)}`);
                }
            } else {
                startSfenToLoad = "startpos";
                startPosition = await service.parseSfen(startSfenToLoad);
            }

            setBasePosition(startPosition);
            setStartSfen(startSfenToLoad);
            setInitialBoard(cloneBoard(startPosition.board));

            await loadMoves(movesToLoad, moveData, startPosition, startSfenToLoad);

            // KIFインポート後は自動的に検討モードに入る
            setIsEditMode(false);
            setIsMatchRunning(false);
        },
        [
            loadMoves,
            setBasePosition,
            setStartSfen,
            setInitialBoard,
            setIsEditMode,
            setIsMatchRunning,
        ],
    );

    return {
        loadMoves,
        handleCopyKif,
        importSfen,
        importKif,
    };
}
