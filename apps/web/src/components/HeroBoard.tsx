import { createInitialPositionState } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
// 入口（@shogi/ui）からは読まない。盤だけの小さな chunk（vite.config.ts の shogi-board）から読み、
// トップページの最初の読み込みに対局画面の部品一式（shogi-match）を載せない。
import { ShogiBoard } from "@shogi/ui/components/shogi-board";
import { boardToGrid } from "@shogi/ui/components/shogi-match/utils/positionUtils";
import type { ReactElement } from "react";

// トップの装飾用に、対局で使う実盤 ShogiBoard を平手初期局面で静的描画する。
// コールバックを渡さなければ純表示になる。装飾なので inert + aria-hidden で
// 81 マスのボタンをフォーカス・支援技術の対象から外す。

const GRID = boardToGrid(createInitialPositionState().board);

export function HeroBoard({ className }: { className?: string }): ReactElement {
    return (
        <div
            inert
            aria-hidden
            className={cn(
                "flex select-none justify-center [--shogi-cell-size:clamp(30px,4vw,40px)]",
                className,
            )}
        >
            <ShogiBoard grid={GRID} />
        </div>
    );
}
