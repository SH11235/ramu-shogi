/**
 * CSA 対局用の visual 盤面表示コンポーネント。
 *
 * `sfen` を `getPositionService().parseSfen()` で `PositionState` に変換し、
 * `ShogiBoard` + `HandPiecesDisplay` で描画する。
 *
 * sfen が null (game_summary 直後 〜 1 手目前) の場合は STARTPOS_SFEN にフォールバック。
 * 駒落ち局面の初期表示は本実装の scope 外 (game_summary event payload 拡張が必要)。
 */
import { deriveLastMove, getPositionService, type PositionState } from "@shogi/app-core";
import { boardToGrid, HandPiecesDisplay, ShogiBoard } from "@shogi/ui";
import { type ReactElement, useEffect, useState } from "react";

const STARTPOS_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

export interface CsaBoardDisplayProps {
    /** 表示対象 SFEN (null/未到着時は初期局面でフォールバック) */
    sfen: string | null;
    /** 直近の指し手 USI (lastMove ハイライト用) */
    lastMoveUsi: string | null;
    /** 自分の手番 ("white" のときは盤面反転) */
    myColor: "black" | "white" | null;
}

/**
 * SFEN を非同期解析し ShogiBoard で描画するコンポーネント。
 * SFEN 切替時は旧 position を残したまま新 position を反映するため、ロード中フラッシュが発生しない。
 */
export function CsaBoardDisplay({
    sfen,
    lastMoveUsi,
    myColor,
}: CsaBoardDisplayProps): ReactElement {
    const targetSfen = sfen ?? STARTPOS_SFEN;
    const [position, setPosition] = useState<PositionState | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setError(null);
        getPositionService()
            .parseSfen(targetSfen)
            .then((pos) => {
                if (!cancelled) setPosition(pos);
            })
            .catch((e: unknown) => {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            });
        return () => {
            cancelled = true;
        };
    }, [targetSfen]);

    if (error) {
        return <div className="text-xs text-destructive">SFEN 解析エラー: {error}</div>;
    }
    if (!position) {
        return <div className="text-xs text-muted-foreground">局面読込中...</div>;
    }

    const grid = boardToGrid(position.board);
    const derived = lastMoveUsi ? deriveLastMove(lastMoveUsi) : undefined;
    // ShogiBoard の lastMove は { from?: string | null; to?: string | null }
    // app-core の LastMove (from?: Square | null; to?: Square) を変換する
    const lastMove = derived ? { from: derived.from ?? undefined, to: derived.to } : undefined;
    const flipBoard = myColor === "white";

    // flipBoard 時は ShogiBoard の grid 自体は反転しない（ShogiBoard 内部で駒の向きのみ反転）
    // ため、上下の HandPiecesDisplay の owner も flipBoard で入れ替える
    const topOwner = flipBoard ? "sente" : "gote";
    const bottomOwner = flipBoard ? "gote" : "sente";

    return (
        <div className="flex flex-col items-center gap-2" data-testid="csa-board-display">
            {/* 上側 (相手) の持ち駒 */}
            <HandPiecesDisplay
                owner={topOwner}
                hand={position.hands[topOwner]}
                selectedPiece={null}
                isActive={false}
                onHandSelect={noop}
                isMatchRunning
                flipBoard={flipBoard}
                size="medium"
            />
            <ShogiBoard grid={grid} lastMove={lastMove} flipBoard={flipBoard} showBoardLabels />
            {/* 下側 (自分) の持ち駒 */}
            <HandPiecesDisplay
                owner={bottomOwner}
                hand={position.hands[bottomOwner]}
                selectedPiece={null}
                isActive={false}
                onHandSelect={noop}
                isMatchRunning
                flipBoard={flipBoard}
                size="medium"
            />
        </div>
    );
}

const noop = (): void => {};
