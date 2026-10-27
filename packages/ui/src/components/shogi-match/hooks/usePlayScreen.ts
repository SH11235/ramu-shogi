import type { KifuTree, NnueSelection, Player, PositionState } from "@shogi/app-core";
import { isKingInCheck, isStudyUsiMove } from "@shogi/app-core";
import type { ReactNode } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useScreenWakeLock } from "../../../hooks/useScreenWakeLock";
import { isHirateStart } from "../play/startPositions";
import type { PlayPhase, PlayScreenConfig } from "../ShogiMatchContext";
import type { EngineOption, SideSetting } from "../types";
import type { useBoardState } from "./useBoardState";
import type { UseKifuNavigationResult } from "./useKifuNavigation";
import { ILLEGAL_MOVE_MESSAGE } from "./useMoveExecution";
import type { useNnueManager } from "./useNnueManager";
import type { usePlayHintSearch } from "./usePlayHintSearch";

type NnueManager = ReturnType<typeof useNnueManager>;
type BoardState = ReturnType<typeof useBoardState>;

interface UsePlayScreenOptions
    extends Pick<
        BoardState,
        | "message"
        | "setMessage"
        | "setSelection"
        | "setPromotionSelection"
        | "position"
        | "positionReady"
        | "startSfen"
        | "gameResult"
        | "setGameResult"
        | "showResultDialog"
        | "setShowResultDialog"
    > {
    isPlayScreen: boolean;
    playPhase: PlayPhase;
    onPlayPhaseChange?: (phase: PlayPhase) => void;
    playSetupFooter?: ReactNode;
    liveSearch: PlayScreenConfig["liveSearch"];
    positionRef: { current: PositionState };
    moves: string[];
    navigation: UseKifuNavigationResult;
    isMatchRunning: boolean;
    isPaused: boolean;
    setIsPaused: (paused: boolean) => void;
    isEditMode: boolean;
    editAllowed: boolean;
    setPositionEditOpen: (open: boolean) => void;
    playStartPly: number;
    setPlayStartPly: (ply: number) => void;
    matchEndedRef: { current: boolean };
    sides: { sente: SideSetting; gote: SideSetting };
    engineOptions: EngineOption[];
    senteNnueSelection: NnueSelection;
    goteNnueSelection: NnueSelection;
    presetConfigs: NnueManager["presetConfigs"];
    nnueList: NnueManager["nnueList"];
    playHint: ReturnType<typeof usePlayHintSearch>;
    hintMultiPv: number;
    setHintMultiPv: (multiPv: number) => void;
    stopAllEngines: () => Promise<void>;
    resumeAutoPlay: () => Promise<void>;
    handleResetToStartpos: () => Promise<void>;
    handleEnterEditMode: () => Promise<void>;
    handleStartReview: () => Promise<void>;
    applyEditedPosition: (next: PositionState) => void;
    importSfen: (sfen: string, moves: string[]) => Promise<void>;
    onOpenAsStudy?: (tree: KifuTree, info: { players?: { sente?: string; gote?: string } }) => void;
}

/**
 * 対局画面（`screen="play"`）の進み具合（設定 → 対局 → 終局）と、その画面の操作。
 * 対局画面でなければ null を返す（状態と effect は持つが、何もしない）。
 */
export function usePlayScreen({
    isPlayScreen,
    playPhase,
    onPlayPhaseChange,
    playSetupFooter,
    liveSearch,
    message,
    setMessage,
    setSelection,
    setPromotionSelection,
    position,
    positionRef,
    positionReady,
    startSfen,
    moves,
    navigation,
    isMatchRunning,
    isPaused,
    setIsPaused,
    isEditMode,
    editAllowed,
    setPositionEditOpen,
    playStartPly,
    setPlayStartPly,
    gameResult,
    setGameResult,
    showResultDialog,
    setShowResultDialog,
    matchEndedRef,
    sides,
    engineOptions,
    senteNnueSelection,
    goteNnueSelection,
    presetConfigs,
    nnueList,
    playHint,
    hintMultiPv,
    setHintMultiPv,
    stopAllEngines,
    resumeAutoPlay,
    handleResetToStartpos,
    handleEnterEditMode,
    handleStartReview,
    applyEditedPosition,
    importSfen,
    onOpenAsStudy,
}: UsePlayScreenOptions): PlayScreenConfig | null {
    const [hintCount, setHintCount] = useState(0);
    const [pendingOpenStudy, setPendingOpenStudy] = useState(false);
    const [pendingRematch, setPendingRematch] = useState(false);
    // 終局後・一時停止から設定の画面へ戻している最中か（戻し終えるまで、対局を始めさせない）。
    const [isPlayResetting, setIsPlayResetting] = useState(false);
    // 対局を始める準備（評価関数の確認・エンジンの初期化）をしている最中か。その間は、設定や開始局面を
    // 変えさせない（準備の途中で局面が変わると、始まった対局の手番と時計が食い違う）。
    const [isPlayStarting, setIsPlayStarting] = useState(false);
    // 対局の始めに 1 度だけ出す知らせ（振り駒の結果など）。
    const [playStartNotice, setPlayStartNotice] = useState<string | null>(null);
    // この対局の始まりの局面（開始局面と、そこまでの手順）。別のページから引き継いだ棋譜の途中から
    // 始めた対局では、手順が空でない。「もう一局」「設定を変える」で戻す先と、待ったで戻せる範囲に使う。
    const playStartRef = useRef<{ sfen: string; moves: string[] } | null>(null);
    // 新しい対局を始めようとしている（始まったら、その時点の開始局面と手順を控える）。
    const [pendingPlayStartCapture, setPendingPlayStartCapture] = useState(false);
    // AI の考慮中や持ち時間の間に画面が消えないようにする（一時停止中は止めない）。
    useScreenWakeLock(isPlayScreen && playPhase === "playing");
    const notifyPlayPhase = useEffectEvent((phase: PlayPhase) => onPlayPhaseChange?.(phase));
    // 消すのは「指せない手」の知らせだけ（進み具合の変化と同じ更新で出たエラーは残す）。
    const clearIllegalMoveMessage = useEffectEvent(() => {
        if (message?.text === ILLEGAL_MOVE_MESSAGE) setMessage(null);
    });
    // 進み具合が変わったら、前の段階の選択とメッセージを持ち越さない
    // （「合法手ではありません」や駒の選択の枠が、一時停止中・終局後まで残らないようにする）。
    // biome-ignore lint/correctness/useExhaustiveDependencies: 進み具合が変わったときだけ
    useEffect(() => {
        if (!isPlayScreen) return;
        notifyPlayPhase(playPhase);
        setSelection(null);
        setPromotionSelection(null);
        clearIllegalMoveMessage();
    }, [isPlayScreen, playPhase]);
    // 指せない手を選んだ知らせは、しばらくしたら消す（次の手を考える邪魔にしない）。
    // 選んでいた駒の枠は、すぐ外す（知らせだけが先に消えて、枠が残るのを避ける）。
    // 依存は知らせそのもの（続けてもう一度指せない手を選んだときも、枠を外して数え直す）。
    useEffect(() => {
        if (!isPlayScreen || message?.text !== ILLEGAL_MOVE_MESSAGE) return;
        setSelection(null);
        const timer = setTimeout(() => setMessage(null), 2500);
        return () => clearTimeout(timer);
    }, [isPlayScreen, message, setMessage, setSelection]);
    const isHirateStartPosition = isHirateStart(startSfen);
    const playerNameFor = (side: Player): string => {
        const setting = sides[side];
        if (setting.role === "human") {
            // 人 対 人では、どちらも「あなた」にならないよう、先手・後手で呼ぶ。
            const bothHumans = sides.sente.role === "human" && sides.gote.role === "human";
            return bothHumans ? (side === "sente" ? "先手" : "後手") : "あなた";
        }
        const engine = engineOptions.find((option) => option.id === setting.engineId);
        if (engine?.kind === "external") return engine.label;
        const selection = side === "sente" ? senteNnueSelection : goteNnueSelection;
        const preset = presetConfigs.find((config) => config.presetKey === selection.presetKey);
        if (preset) return preset.displayName;
        const custom = nnueList.find((nnue) => nnue.id === selection.nnueId);
        return custom?.displayName ?? "簡易AI";
    };
    const openStudyNow = useEffectEvent(() => {
        // 対局者の名前を付けるのは、指した対局だけ（局面だけのノートは「取り込んだ局面」として作る）。
        onOpenAsStudy?.(
            navigation.tree,
            navigation.tree.nodes.size > 1
                ? { players: { sente: playerNameFor("sente"), gote: playerNameFor("gote") } }
                : {},
        );
    });
    // 局面の編集中は、棋譜のツリーが編集前の局面のまま。確定（編集モードを抜ける）を待ってから開く。
    useEffect(() => {
        if (!pendingOpenStudy || isEditMode) return;
        setPendingOpenStudy(false);
        openStudyNow();
    }, [pendingOpenStudy, isEditMode]);
    const treeFitsStudy = [...navigation.tree.nodes.values()].every(
        (node) => node.usiMove === null || isStudyUsiMove(node.usiMove),
    );
    // 終局後・一時停止から、同じ開始局面の設定の画面に戻す。
    const resetForNewGame = async () => {
        if (isPlayResetting) return;
        setIsPlayResetting(true);
        try {
            await resetForNewGameUnguarded();
        } finally {
            setIsPlayResetting(false);
        }
    };
    const resetForNewGameUnguarded = async () => {
        matchEndedRef.current = false;
        setGameResult(null);
        setShowResultDialog(false);
        setHintCount(0);
        playHint.reset();
        setIsPaused(false);
        setPositionEditOpen(false);
        setPlayStartNotice(null);
        await stopAllEngines();
        const start = playStartRef.current ?? { sfen: startSfen, moves: [] };
        if (isHirateStart(start.sfen) && start.moves.length === 0) {
            await handleResetToStartpos();
        } else {
            // 編集した局面・引き継いだ棋譜の途中から始めた対局は、同じ始まりの局面に戻す。
            await importSfen(start.sfen, start.moves);
        }
    };
    // 「もう一局」は、設定の画面に戻ったのを待ってから始める（戻す処理が行き渡ってから）。
    const startPlayMatch = async () => {
        if (isPlayStarting) return;
        setIsPlayStarting(true);
        // 前に出ていた知らせ（前回の開始の失敗など）を、始め直すときに持ち越さない。
        setMessage(null);
        try {
            await resumeAutoPlay();
        } finally {
            setIsPlayStarting(false);
        }
    };
    const startRematch = useEffectEvent(() => {
        void startPlayMatch();
    });
    useEffect(() => {
        if (!pendingRematch || isPlayResetting) return;
        setPendingRematch(false);
        // 設定の画面へ戻せなかった（開始局面の取得に失敗した）ときは、始めない。
        if (playPhase !== "setup" || moves.length !== (playStartRef.current?.moves.length ?? 0)) {
            return;
        }
        startRematch();
    }, [pendingRematch, isPlayResetting, playPhase, moves.length]);
    // 対局が実際に始まった時点の開始局面と手順を、この対局の始まりとして控える
    // （「もう一局」で戻す先と、待ったで戻せる範囲に使う）。
    useEffect(() => {
        if (!pendingPlayStartCapture || !isMatchRunning) return;
        setPendingPlayStartCapture(false);
        playStartRef.current = { sfen: startSfen, moves: [...moves] };
        setPlayStartPly(moves.length);
    }, [pendingPlayStartCapture, isMatchRunning, startSfen, moves, setPlayStartPly]);
    return isPlayScreen
        ? {
              phase: playPhase,
              liveSearch,
              isCustomStart: !isHirateStartPosition || (playPhase === "setup" && moves.length > 0),
              busy: isPlayResetting || pendingRematch || isPlayStarting,
              startNotice: playPhase === "playing" && moves.length < 2 ? playStartNotice : null,
              startPly: playStartPly,
              startMatch: (notice?: string) => {
                  if (isPlayResetting || isPlayStarting) return;
                  setPositionEditOpen(false);
                  if (!isPaused) {
                      // 新しい対局の始まり。始まりの局面は、実際に始まった時点で控える
                      // （開始の処理が、編集した局面の確定やパス権の初期化で開始局面・手順を
                      // 作り直すことがあるので、押した時点の値は使わない）。
                      setPendingPlayStartCapture(true);
                      setPlayStartNotice(notice ?? null);
                      setHintCount(0);
                      playHint.reset();
                  }
                  void startPlayMatch();
              },
              openPositionEditor: () => {
                  setPositionEditOpen(true);
                  if (!isEditMode) void handleEnterEditMode();
              },
              closePositionEditor: () => setPositionEditOpen(false),
              resetToStartpos: () => {
                  if (isPlayResetting || isPlayStarting) return;
                  void (async () => {
                      setIsPlayResetting(true);
                      try {
                          await handleResetToStartpos();
                      } finally {
                          setIsPlayResetting(false);
                      }
                  })();
              },
              startSfen,
              loadStartPosition: (sfen: string) => {
                  if (isPlayResetting || isPlayStarting) return;
                  void (async () => {
                      // 読み込みが済むまで、対局を始めさせない（読み込みがあとから完了すると、
                      // 始まった対局の局面を置き換えて止めてしまう）。
                      setIsPlayResetting(true);
                      try {
                          setPositionEditOpen(false);
                          await importSfen(sfen, []);
                      } finally {
                          setIsPlayResetting(false);
                      }
                  })();
              },
              playerNames: { sente: playerNameFor("sente"), gote: playerNameFor("gote") },
              editTurn: position.turn,
              setEditTurn: (turn: Player) => {
                  if (!editAllowed || turn === positionRef.current.turn) return;
                  applyEditedPosition({ ...positionRef.current, turn });
              },
              inCheck: isMatchRunning && isKingInCheck(position),
              newGame: () => {
                  void resetForNewGame();
              },
              rematch: () => {
                  void resetForNewGame().then(() => setPendingRematch(true));
              },
              openStudy:
                  onOpenAsStudy === undefined || isMatchRunning || !treeFitsStudy
                      ? null
                      : () => {
                            if (isEditMode) {
                                // 局面の準備が済んでいなければ、確定できない（待ちだけが残るのを避ける）。
                                if (!positionReady) return;
                                setPendingOpenStudy(true);
                                void handleStartReview();
                            } else {
                                openStudyNow();
                            }
                        },
              requestHint: () => {
                  if (playHint.status.phase === "preparing") return;
                  setHintCount((count) => count + 1);
                  playHint.request();
              },
              stopHint: playHint.stop,
              resumeHint: playHint.resume,
              hintStatus: playHint.status,
              hintMultiPv,
              setHintMultiPv,
              hintCount,
              hintPly: playHint.status.ply,
              setupFooter: playSetupFooter ?? null,
              gameResult,
              resultDialogOpen: showResultDialog,
              closeResultDialog: () => setShowResultDialog(false),
          }
        : null;
}
