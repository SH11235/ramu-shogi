import type { PieceType, Player } from "@shogi/app-core";
import { useEffect, useEffectEvent, useState } from "react";
import type { ShogiBoardCell, ShogiBoardMoveShadow } from "../../shogi-board";
import { computeMoveShadow } from "../utils/moveShadow";

type MoveShadowSelection = { kind: "square"; square: string } | { kind: "hand"; piece: PieceType };

interface UseMoveShadowParams {
    /** 影を出してよい状態か（局面編集中などは false） */
    enabled: boolean;
    selection: MoveShadowSelection | null;
    grid: ShogiBoardCell[][];
    turn: Player;
    /** 現局面を表すキー。局面が変わったら、前の局面の合法手で影を出さないために使う */
    positionKey: string;
    /** 現局面の合法手を返す（指し手の実行と同じキャッシュを通すこと） */
    getLegalSet: () => Promise<ReadonlySet<string> | null>;
}

/**
 * 選んでいる駒の「影」を出すマスを求める。
 *
 * 合法手は駒を選んだ時に 1 度だけ取りに行く（指すときに使うのと同じキャッシュなので、
 * 1 局面につき合法手生成は 1 回のまま）。マウスの動きは見ない: 影を出すかどうかは盤の CSS の
 * `:hover` が決めるので、このフックが再描画を起こすのは「選んだ時」「合法手が届いた時」
 * 「外した時」だけ。
 */
export function useMoveShadow({
    enabled,
    selection,
    grid,
    turn,
    positionKey,
    getLegalSet,
}: UseMoveShadowParams): ShogiBoardMoveShadow | null {
    const [resolved, setResolved] = useState<{
        positionKey: string;
        legal: ReadonlySet<string>;
    } | null>(null);
    const resolveLegalSet = useEffectEvent(() => getLegalSet());
    const active = enabled && selection !== null;

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        resolveLegalSet()
            .then((legal) => {
                if (cancelled || !legal) return;
                setResolved((prev) =>
                    prev && prev.positionKey === positionKey && prev.legal === legal
                        ? prev
                        : { positionKey, legal },
                );
            })
            // 合法手が取れないときは影を出さないだけ（指すときに改めて確かめる）
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [active, positionKey]);

    if (!active || resolved?.positionKey !== positionKey) return null;
    return computeMoveShadow({ selection, grid, turn, legalMoves: resolved.legal });
}
