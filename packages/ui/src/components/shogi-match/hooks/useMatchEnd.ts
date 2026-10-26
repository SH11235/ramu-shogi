import type { GameResult, Player, PositionState } from "@shogi/app-core";
import { getPositionService } from "@shogi/app-core";
import { useEffect, useEffectEvent } from "react";
import type { Message, SideSetting } from "../types";
import { buildLegalCacheKey, type LegalMoveCache } from "../utils/legalMoveCache";
import type { UsePassRightsResult } from "./usePassRights";

type LegalMovesFetcher = (
    sfen: string,
    moves: string[],
    options?: { passRights?: { sente: number; gote: number } },
) => Promise<string[]>;

/**
 * 対局の終わり方（終局の処理・投了・人の手番の詰み）。AI の手番の詰みは、エンジンの制御が
 * "bestmove none" を受けて終局させる。
 */
export function useMatchEnd({
    matchEndedRef,
    endMatchRef,
    stopAllEnginesRef,
    setGameResult,
    setShowResultDialog,
    playMatchEndSound,
    setIsMatchRunning,
    setIsPaused,
    stopTicking,
    setMessage,
    isPlayScreen,
    sides,
    positionRef,
    position,
    positionReady,
    isMatchRunning,
    startSfen,
    moves,
    fetchLegalMoves,
    passRights,
    legalCache,
}: {
    matchEndedRef: { current: boolean };
    /** 時計など、終局を先に作る側から呼ぶための参照。毎回のレンダーで、いまの endMatch を入れる。 */
    endMatchRef: { current: ((result: GameResult) => Promise<void>) | null };
    stopAllEnginesRef: { current: () => Promise<void> };
    setGameResult: (result: GameResult | null) => void;
    setShowResultDialog: (show: boolean) => void;
    playMatchEndSound: () => void;
    setIsMatchRunning: (running: boolean) => void;
    setIsPaused: (paused: boolean) => void;
    stopTicking: () => void;
    setMessage: (message: Message | null) => void;
    isPlayScreen: boolean;
    sides: { sente: SideSetting; gote: SideSetting };
    positionRef: { current: PositionState };
    position: PositionState;
    positionReady: boolean;
    isMatchRunning: boolean;
    startSfen: string;
    moves: string[];
    fetchLegalMoves?: LegalMovesFetcher;
    passRights: UsePassRightsResult;
    legalCache: LegalMoveCache;
}) {
    const endMatch = async (result: GameResult) => {
        if (matchEndedRef.current) return;
        matchEndedRef.current = true;
        setGameResult(result);
        setShowResultDialog(true);
        playMatchEndSound();
        setIsMatchRunning(false);
        setIsPaused(false);
        stopTicking();
        try {
            await stopAllEnginesRef.current();
        } catch (error) {
            console.error("エンジン停止に失敗しました:", error);
            setMessage({
                text: `対局終了処理でエンジン停止に失敗しました: ${String(error ?? "unknown")}`,
                type: "error",
            });
        }
    };

    endMatchRef.current = endMatch;

    // 投了処理
    const handleResign = async () => {
        const senteIsHuman = sides.sente.role === "human";
        const goteIsHuman = sides.gote.role === "human";
        // 対局画面で人が片方だけなら、投了するのはその人（相手の AI の手番中に押しても、自分の負けにする）。
        const currentTurn: Player =
            isPlayScreen && senteIsHuman !== goteIsHuman
                ? senteIsHuman
                    ? "sente"
                    : "gote"
                : positionRef.current.turn;
        const result: GameResult = {
            winner: currentTurn === "sente" ? "gote" : "sente",
            reason: { kind: "resignation", loser: currentTurn },
            totalMoves: moves.length,
        };
        await endMatch(result);
    };

    // 終局したかどうかと終局の処理は、合法手を調べ終えた時点の最新を使う（変わっても調べ直さない）。
    const isMatchEnded = useEffectEvent(() => matchEndedRef.current);
    const endByCheckmate = useEffectEvent((result: GameResult) => endMatch(result));

    // 詰み検出: 人間の手番で合法手がない場合に自動終局
    // エンジンの手番は engine-controller が "bestmove none" を検知して処理するためスキップ
    useEffect(() => {
        if (!isMatchRunning || !positionReady || isMatchEnded()) return;
        if (sides[position.turn].role === "engine") return;

        let cancelled = false;
        const passRightsOption = passRights.getPassRightsOption();
        void (async () => {
            try {
                const resolver = fetchLegalMoves
                    ? () => fetchLegalMoves(startSfen, moves, passRightsOption)
                    : () => getPositionService().getLegalMoves(startSfen, moves, passRightsOption);
                const legal = await legalCache.getOrResolve(
                    buildLegalCacheKey(startSfen, moves, passRightsOption),
                    resolver,
                );
                if (cancelled || isMatchEnded()) return;
                if (legal.size === 0) {
                    const loser: Player = position.turn;
                    const winner: Player = loser === "sente" ? "gote" : "sente";
                    await endByCheckmate({
                        winner,
                        reason: { kind: "checkmate", loser },
                        totalMoves: moves.length,
                    });
                }
            } catch {
                // 合法手取得失敗時は無視
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [
        isMatchRunning,
        positionReady,
        moves,
        startSfen,
        position.turn,
        fetchLegalMoves,
        sides,
        passRights,
        legalCache,
    ]);

    return { endMatch, handleResign };
}
