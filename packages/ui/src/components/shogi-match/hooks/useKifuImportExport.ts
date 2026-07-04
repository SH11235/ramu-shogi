import type { BoardState, LastMove, PositionState } from "@shogi/app-core";
import {
    applyMoveWithState,
    cloneBoard,
    deriveLastMove,
    getPositionService,
} from "@shogi/app-core";
import type { Message, PassRightsSettings, SideSetting } from "../types";
import type { KifMove } from "../utils/kifFormat";
import { exportToKifString } from "../utils/kifFormat";
import type { KifMoveData } from "../utils/kifParser";
import { parseSfen } from "../utils/kifParser";
import { buildPassRightsOptionForLegalMoves } from "../utils/passRightsSettings";
import type { UseKifuNavigationResult } from "./useKifuNavigation";

/**
 * `initialReview.moveData` の 1 手分の評価値・消費時間。
 *
 * `initialReview.moves` と同じ index で対応する (undefined = その手の付随情報なし)。
 * 評価値は **先手視点** (`+` = 先手有利) 前提で、`importSfen` 内で
 * `navigation.addMove(..., { eval: { normalized: true } })` としてそのまま格納する
 * (KIF インポート経路と同じ扱い。符号反転しない)。
 */
export interface ReviewMoveEval {
    /** 消費時間 (ミリ秒)。 */
    elapsedMs?: number;
    /** 評価値 (センチポーン、先手視点。`+` = 先手有利)。 */
    evalCp?: number;
    /**
     * 詰み手数 (先手視点、`+` = 先手勝ち)。
     * ライブ観戦の wire は詰み手数を持たない (詰みは大きな evalCp センチネルで表現)
     * ため通常は未設定。KIF インポート等の経路で詰み手数が判る場合のみ使う。
     */
    evalMate?: number;
}

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
    importSfen: (
        sfen: string,
        movesToLoad: string[],
        options?: {
            gotoPly?: number;
            isStale?: () => boolean;
            /** `movesToLoad` と同じ index で対応する評価値・消費時間 (先手視点)。 */
            moveData?: (ReviewMoveEval | undefined)[];
        },
    ) => Promise<void>;
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
    const loadMoves = async (
        list: string[],
        moveData: KifMoveData[] | undefined,
        startPosition: PositionState,
        startSfenToLoad: string,
    ) => {
        const filtered = list.filter(Boolean);
        const service = getPositionService();
        // パス入り棋譜の場合はpassRightsを渡す
        const passRightsOption = buildPassRightsOptionForLegalMoves(passRightsSettings, filtered);
        const result = await service.replayMovesStrict(startSfenToLoad, filtered, passRightsOption);

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
    };

    /**
     * KIFコピー用コールバック
     */
    const handleCopyKif = (): string => {
        return exportToKifString(kifMoves, boardHistory, {
            startTime: new Date(),
            senteName: sides.sente.role === "engine" ? "エンジン" : "人間",
            goteName: sides.gote.role === "engine" ? "エンジン" : "人間",
            includeEval: true, // 評価値もコメントとして出力
            startSfen,
        });
    };

    /**
     * SFENインポート（局面 + 指し手）
     * インポート後は自動的に検討モードに入る
     */
    const importSfen = async (
        sfen: string,
        movesToLoad: string[],
        options?: {
            gotoPly?: number;
            isStale?: () => boolean;
            moveData?: (ReviewMoveEval | undefined)[];
        },
    ) => {
        const service = getPositionService();
        try {
            // 新しい開始局面を設定
            const newPosition = await service.parseSfen(sfen);
            // live 観戦の連続着手で先行 import が後着 import に追い越された場合、
            // 古い moves で navigation を上書きしないよう適用前に最新性を確認して中止する。
            if (options?.isStale?.()) {
                return;
            }
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
                for (let i = 0; i < movesToLoad.length; i++) {
                    const move = movesToLoad[i];
                    const applyResult = applyMoveWithState(currentPos, move, {
                        validateTurn: false,
                    });
                    if (applyResult.ok) {
                        // moveData は先手視点なので loadMoves (KIF) と同じく normalized: true。
                        const data = options?.moveData?.[i];
                        navigation.addMove(move, applyResult.next, {
                            elapsedMs: data?.elapsedMs,
                            eval:
                                data?.evalCp !== undefined || data?.evalMate !== undefined
                                    ? {
                                          scoreCp: data.evalCp,
                                          scoreMate: data.evalMate,
                                          normalized: true,
                                      }
                                    : undefined,
                        });
                        currentPos = applyResult.next;
                        appliedMoves.push(move);
                    } else {
                        break;
                    }
                }
                setLastMove(deriveLastMove(appliedMoves.at(-1)));
                // 末尾以外の局面を検討中だった観戦者のカーソルを維持する。
                // addMove 群と同じ同期ブロックで goToPly することで 1 レンダーに
                // まとまり、末尾局面が一瞬見える描画を防ぐ。適用手数を上限にクランプ
                // して、不正手などで適用手が短縮された場合も範囲外へ飛ばさない。
                const { gotoPly } = options ?? {};
                if (gotoPly !== undefined) {
                    navigation.goToPly(Math.max(0, Math.min(gotoPly, appliedMoves.length)));
                }
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
    };

    /**
     * KIFインポート（開始局面情報があれば使用）
     * インポート後は自動的に検討モードに入る
     */
    const importKif = async (
        movesToLoad: string[],
        moveData: KifMoveData[],
        startSfenFromKif?: string,
    ) => {
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
    };

    return {
        loadMoves,
        handleCopyKif,
        importSfen,
        importKif,
    };
}
