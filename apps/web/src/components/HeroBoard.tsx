import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";

// トップの装飾用に描く静的な初期局面盤。対局で使う ShogiBoard(状態・DnD・engine
// 依存) は持ち込まず、design-system の shogi-* / wafuu-* トークンだけで組む軽量版。
// 「盤を全ティア共通のアンカーにする」方針に沿い、実盤と同じ配色トークンを使う。
// 先手=朱・後手=藍の意味色を駒に薄く乗せ、後手は 180 度回転する。

type Side = "sente" | "gote";
interface Cell {
    piece: string;
    side: Side;
}
type Row = (Cell | null)[];

const S = (piece: string): Cell => ({ piece, side: "sente" });
const G = (piece: string): Cell => ({ piece, side: "gote" });

// 平手初期配置（意匠用。段=上から後手→先手）
const START: Row[] = [
    [G("香"), G("桂"), G("銀"), G("金"), G("玉"), G("金"), G("銀"), G("桂"), G("香")],
    [null, G("飛"), null, null, null, null, null, G("角"), null],
    [G("歩"), G("歩"), G("歩"), G("歩"), G("歩"), G("歩"), G("歩"), G("歩"), G("歩")],
    [null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null],
    [S("歩"), S("歩"), S("歩"), S("歩"), S("歩"), S("歩"), S("歩"), S("歩"), S("歩")],
    [null, S("角"), null, null, null, null, null, S("飛"), null],
    [S("香"), S("桂"), S("銀"), S("金"), S("王"), S("金"), S("銀"), S("桂"), S("香")],
];

interface Square {
    id: string;
    cell: Cell | null;
    light: boolean;
}

// 盤面を平坦化し、筋-段の一意 id(例 "7-1" = 7筋1段目)を持たせておく。render 側は
// 配列 index を key に使わず、この id を key にする（局面は静的なので id は不変）。
const SQUARES: Square[] = START.flatMap((row, r) =>
    row.map((cell, c) => ({
        id: `${9 - c}-${r + 1}`,
        cell,
        light: (r + c) % 2 === 0,
    })),
);

export function HeroBoard({ className }: { className?: string }): ReactElement {
    return (
        <div
            aria-hidden
            className={cn(
                "grid aspect-square w-full grid-cols-9 gap-px rounded-sm border-2 border-shogi-outer-border bg-shogi-border p-px shadow-card",
                className,
            )}
        >
            {SQUARES.map(({ id, cell, light }) => (
                <div
                    key={id}
                    className={cn(
                        "flex items-center justify-center",
                        light ? "bg-shogi-cell-light" : "bg-shogi-cell-dark",
                    )}
                >
                    {cell && (
                        <span
                            className={cn(
                                "flex aspect-[6/7] w-[82%] items-center justify-center rounded-[2px] bg-shogi-piece-bg font-display text-[clamp(9px,2.1vw,15px)] leading-none shadow-sm",
                                cell.side === "sente"
                                    ? "border-b-2 border-wafuu-shu/40 text-wafuu-shu"
                                    : "rotate-180 border-b-2 border-wafuu-ai/40 text-wafuu-ai",
                            )}
                        >
                            {cell.piece}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}
