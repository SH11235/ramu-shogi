import type { Player } from "@shogi/app-core";
import { getPositionService } from "@shogi/app-core";
import { useEffect } from "react";
import type { SideSetting } from "../types";
import type { LegalMoveCache } from "../utils/legalMoveCache";
import type { UsePassRightsResult } from "./usePassRights";

interface UseLegalMovePrefetchParams {
    isMatchRunning: boolean;
    positionReady: boolean;
    positionTurn: Player;
    sides: { sente: SideSetting; gote: SideSetting };
    moves: string[];
    legalCache: LegalMoveCache;
    passRights: UsePassRightsResult;
    startSfen: string;
    fetchLegalMoves?: (
        sfen: string,
        moves: string[],
        options?: { passRights?: { sente: number; gote: number } },
    ) => Promise<string[]>;
}

/**
 * パス可否判定のため、キャッシュ未作成時は合法手をプリフェッチするフック
 *
 * 対局中、人間の手番の場合に合法手を事前取得してキャッシュする。
 * パス権が使用可能かどうかの判定に使用される。
 */
export function useLegalMovePrefetch({
    isMatchRunning,
    positionReady,
    positionTurn,
    sides,
    moves,
    legalCache,
    passRights,
    startSfen,
    fetchLegalMoves,
}: UseLegalMovePrefetchParams): void {
    useEffect(() => {
        if (!isMatchRunning || !positionReady) return;
        if (sides[positionTurn].role !== "human") return;
        const ply = moves.length;
        if (legalCache.isCached(ply)) return;

        const passRightsOption = passRights.getPassRightsOption();
        const resolver = async () => {
            if (fetchLegalMoves) {
                return fetchLegalMoves(startSfen, moves, passRightsOption);
            }
            return getPositionService().getLegalMoves(startSfen, moves, passRightsOption);
        };

        // エラーはパスボタンクリック時の再解決に委ねる
        void legalCache
            .getOrResolve(ply, resolver)
            .then((result) => {
                if (moves.length === ply) {
                    passRights.setCanPassLegal(result.has("pass"));
                }
            })
            .catch(() => undefined);
    }, [
        fetchLegalMoves,
        isMatchRunning,
        legalCache,
        passRights,
        positionTurn,
        positionReady,
        sides,
        startSfen,
        moves,
    ]);
}
