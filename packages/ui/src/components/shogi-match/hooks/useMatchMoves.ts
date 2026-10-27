import type { LastMove, Player, PositionState } from "@shogi/app-core";
import { applyMoveWithState, getPositionService } from "@shogi/app-core";
import { isCpuLosing } from "../../../hooks/moveSoundScene";
import type { Message, PassRightsSettings, SideSetting } from "../types";
import { buildLegalCacheKey, type LegalMoveCache } from "../utils/legalMoveCache";
import type { ClockTurnOptions } from "./useClockManager";
import type { UseKifuNavigationResult } from "./useKifuNavigation";
import type { useLiveSearchInfo } from "./useLiveSearchInfo";
import type { LegalMovesFetcher } from "./useMatchEnd";
import type { useMatchSounds } from "./useMatchSounds";
import type { UsePassRightsResult } from "./usePassRights";

type LiveSearch = ReturnType<typeof useLiveSearchInfo>;

/**
 * 対局中に手を進める・戻す操作（AI の手の適用、パス、待った）。盤や持ち駒からの人の手は
 * useMoveExecution が適用する。
 */
export function useMatchMoves({
    moveProcessingRef,
    matchEndedRef,
    positionRef,
    turnStartTimeRef,
    stopAllEnginesRef,
    prepareEnginesRef,
    handleMoveFromEngineRef,
    isPlayScreen,
    playStartPly,
    sides,
    startSfen,
    moves,
    navigation,
    passRightsSettings,
    passRights,
    fetchLegalMoves,
    legalCache,
    clearLegalCache,
    stopTicking,
    updateClocksForNextTurn,
    endIfFlaggedBeforeMove,
    setIsMatchRunning,
    setIsPaused,
    setLastMove,
    setSelection,
    setMessage,
    playMoveSound,
    getPendingSearchStats,
    deletePendingSearchStats,
    logEngineError,
}: {
    /** 待った・パスの処理中（連打や、処理中に届いた AI の手を受け付けない）。 */
    moveProcessingRef: { current: boolean };
    matchEndedRef: { current: boolean };
    positionRef: { current: PositionState };
    /** いまの手番が始まった時刻（消費時間の計算に使う）。 */
    turnStartTimeRef: { current: number };
    stopAllEnginesRef: { current: () => Promise<void> };
    prepareEnginesRef: { current: () => Promise<boolean> };
    /** エンジンの制御から呼ぶための参照。毎回のレンダーで、いまの処理を入れる。 */
    handleMoveFromEngineRef: { current: (move: string) => void };
    isPlayScreen: boolean;
    playStartPly: number;
    sides: { sente: SideSetting; gote: SideSetting };
    startSfen: string;
    moves: string[];
    navigation: UseKifuNavigationResult;
    passRightsSettings: PassRightsSettings | undefined;
    passRights: UsePassRightsResult;
    fetchLegalMoves?: LegalMovesFetcher;
    legalCache: LegalMoveCache;
    clearLegalCache: () => void;
    stopTicking: () => void;
    updateClocksForNextTurn: (nextTurn: Player, options?: ClockTurnOptions) => void;
    endIfFlaggedBeforeMove: (mover: Player) => boolean;
    setIsMatchRunning: (running: boolean) => void;
    setIsPaused: (paused: boolean) => void;
    setLastMove: (lastMove: LastMove | undefined) => void;
    setSelection: (selection: null) => void;
    setMessage: (message: Message | null) => void;
    playMoveSound: ReturnType<typeof useMatchSounds>["playMoveSound"];
    getPendingSearchStats: LiveSearch["getPendingSearchStats"];
    deletePendingSearchStats: LiveSearch["deletePendingSearchStats"];
    logEngineError: (message: string) => void;
}) {
    // 待った処理（2手戻す：相手の手と自分の前の手を戻す）
    const handleUndo = async () => {
        // 処理中なら無視（連打・競合防止）
        if (moveProcessingRef.current) return;

        const moveCount = moves.length;
        if (moveCount === 0) return;
        // 対局画面では、この対局で指した手だけを戻す（引き継いだ棋譜の手は戻さない）。戻せる手が
        // 無ければ、時計やエンジンを止める前に何もせず戻る。
        if (isPlayScreen && moveCount - playStartPly <= 0) return;

        moveProcessingRef.current = true;

        try {
            // まず時計を停止（待った処理中に時間が進むのを防ぐ）
            stopTicking();

            // エンジンの思考を停止（旧局面のbestmoveが適用されるのを防ぐ）
            await stopAllEnginesRef.current();

            // 2手戻す（自分の前の手まで戻る）
            // ただし、1手しかない場合は1手だけ戻す
            // 対局画面の人 対 人では、直前の 1 手だけ戻す（交互に指しているので、2 手戻すと相手の手まで消える）。
            const bothHumans = sides.sente.role === "human" && sides.gote.role === "human";
            const wantedUndoCount = isPlayScreen && bothHumans ? 1 : moveCount >= 2 ? 2 : 1;
            // 対局画面では、この対局で指した手だけを戻す（引き継いだ棋譜の手は戻さない）。
            const undoCount = isPlayScreen
                ? Math.min(wantedUndoCount, moveCount - playStartPly)
                : wantedUndoCount;

            // 待った後の手番を明示的に計算
            // React のバッチ処理により navigation.goBack() 後の positionRef.current は
            // 即座に更新されないため、手番を事前に計算する
            const turnBeforeUndo = positionRef.current.turn;
            const turnAfterUndo =
                undoCount % 2 === 1
                    ? turnBeforeUndo === "sente"
                        ? "gote"
                        : "sente"
                    : turnBeforeUndo;

            // 取り消す手は、直前の手（手番でない側）から交互にさかのぼる。その手で得た加算を返させる。
            const undone = { sente: 0, gote: 0 };
            for (let i = 0; i < undoCount; i++) {
                const mover = (i % 2 === 0) === (turnBeforeUndo === "sente") ? "gote" : "sente";
                undone[mover] += 1;
            }

            for (let i = 0; i < undoCount; i++) {
                navigation.goBack();
            }
            // 対局画面では、取り消した手を棋譜から消す（終局後の棋譜や研究ノートに残さない）。
            if (isPlayScreen) navigation.truncate();

            // 停止で破棄したエンジンを時計再開前に初期化し直す
            // （初期化時間が秒読みから差し引かれるのを防ぐ）
            if (!(await prepareEnginesRef.current())) {
                // 一時停止扱いにして再開操作からやり直せるようにする。
                // 秒読みは undo 後の手番用にリセットするが、isMatchRunning=false の
                // 間は時計の interval が動かないため実時間は消費されない
                setIsMatchRunning(false);
                setIsPaused(true);
                updateClocksForNextTurn(turnAfterUndo, { undone });
                setMessage({ text: "エンジンの初期化に失敗しました。", type: "error" });
                return;
            }

            // 待った後の思考時間計測を新しく開始
            turnStartTimeRef.current = Date.now();
            // 秒読みをリセット（計算した手番で時計を更新・開始）
            updateClocksForNextTurn(turnAfterUndo, { undone });
        } finally {
            moveProcessingRef.current = false;
        }
    };

    // エンジンの手・パスの適用後の共通処理（盤や持ち駒からの人の手は useMoveExecution が適用する）
    const applyMoveAndUpdateState = (
        move: string,
        nextPosition: PositionState,
        lastMoveInfo: LastMove | undefined,
        source?: "human" | "engine",
    ) => {
        if (endIfFlaggedBeforeMove(positionRef.current.turn)) return;
        // サウンドフィードバック（positionRef はまだ指す前の局面）。
        // 探索結果は bestmove を返した時点の手数（= この手を足す前の moves.length）で onSearchComplete が記録し、
        // 下の navigation.addMove で棋譜に移すまで残っている。値はエンジン自身から見た評価値。
        playMoveSound(
            move,
            positionRef.current,
            nextPosition,
            source === "engine" ? "opponent" : "self",
            source === "engine" && isCpuLosing(getPendingSearchStats(moves.length)),
        );
        // 消費時間を計算
        const elapsedMs = Date.now() - turnStartTimeRef.current;
        // 棋譜ナビゲーションに手を追加（局面更新はonPositionChangeで自動実行）
        const ply = moves.length;
        const searchStats = source === "engine" ? getPendingSearchStats(ply) : undefined;
        navigation.addMove(move, nextPosition, { elapsedMs, searchStats });
        if (source === "engine") deletePendingSearchStats(ply);
        setLastMove(lastMoveInfo);
        setSelection(null);
        setMessage(null);
        clearLegalCache();
        // ターン開始時刻をリセット
        turnStartTimeRef.current = Date.now();
        updateClocksForNextTurn(nextPosition.turn, { moved: true });
    };

    // エンジンからの手を受け取って適用するコールバック
    const handleMoveFromEngine = (move: string) => {
        // 待った・パス処理中は無視（旧局面への適用防止）
        if (moveProcessingRef.current) return;
        if (matchEndedRef.current) return;
        // 手番チェック: エンジンの手番でない場合は無視
        // （待った→パス→待った等の連続操作で古いbestmoveが届く競合状態を防止）
        if (sides[positionRef.current.turn].role !== "engine") {
            console.warn(
                `Ignoring engine move "${move}": current turn is ${positionRef.current.turn} (human)`,
            );
            return;
        }
        const result = applyMoveWithState(positionRef.current, move, {
            validateTurn: false,
        });
        if (!result.ok) {
            logEngineError(
                `engine move rejected (${move || "empty"}): ${result.error ?? "unknown"}`,
            );
            return;
        }
        applyMoveAndUpdateState(move, result.next, result.lastMove, "engine");
    };
    handleMoveFromEngineRef.current = handleMoveFromEngine;

    // パス手を処理するコールバック
    // 人間・エンジン両方のパス手で使用される
    const handlePassMove = async () => {
        // 処理中なら無視（待ったとの競合防止）
        if (moveProcessingRef.current) return;
        if (matchEndedRef.current) return;
        if (!passRightsSettings?.enabled) return;
        const rights = positionRef.current.passRights ?? passRights.ensurePassRightsInitialized();
        const hasRightsNow = rights ? rights[positionRef.current.turn] > 0 : false;
        if (!hasRightsNow) {
            setMessage({ text: "パス権がありません", type: "error" });
            return;
        }

        moveProcessingRef.current = true;

        try {
            // 合法手をチェック（王手中はパスが合法手に含まれない）
            // エンジン側の can_pass() は王手中のパスを禁止しており、
            // パスが合法でない場合にloadPositionするとパニックするため、事前にチェック
            try {
                const passRightsOption = passRights.getPassRightsOption();
                const resolver = fetchLegalMoves
                    ? () => fetchLegalMoves(startSfen, moves, passRightsOption)
                    : () => getPositionService().getLegalMoves(startSfen, moves, passRightsOption);
                const movesKey = buildLegalCacheKey(startSfen, moves, passRightsOption);
                let legal = await legalCache.getOrResolve(movesKey, resolver);
                if (!legal || !legal.has("pass")) {
                    // パス権ありでも合法手に含まれない場合はキャッシュをクリアして再取得（パス権オプション漏れ対策）
                    clearLegalCache();
                    legal = await legalCache.getOrResolve(movesKey, resolver);
                    if (!legal || !legal.has("pass")) {
                        setMessage({ text: "王手されているためパスできません", type: "error" });
                        return;
                    }
                }
            } catch (error) {
                setMessage({ text: `合法手の取得に失敗しました: ${String(error)}`, type: "error" });
                return;
            }

            // "pass" を applyMoveWithState で適用
            // validateTurn: false の理由:
            // - 人間のパスはUI側で手番チェック済み（sides[position.turn].role === "human"）
            // - エンジンのパスも受け付けるため、ここでは手番検証をスキップ
            const result = applyMoveWithState(positionRef.current, "pass", {
                validateTurn: false,
            });

            if (!result.ok) {
                setMessage({ text: `パスに失敗しました: ${result.error}`, type: "error" });
                return;
            }

            applyMoveAndUpdateState("pass", result.next, result.lastMove);
        } finally {
            moveProcessingRef.current = false;
        }
    };

    return { handleUndo, handlePassMove };
}
