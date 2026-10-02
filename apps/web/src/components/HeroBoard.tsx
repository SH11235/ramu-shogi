import { applyMoveWithState, createInitialPositionState } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import { boardToGrid, ShogiBoard } from "@shogi/ui";
import { type ReactElement, useEffect, useState } from "react";

// トップの装飾用に、対局で使う実盤 ShogiBoard を描画する。装飾なので inert +
// aria-hidden で 81 マスのボタンをフォーカス・支援技術の対象から外す。
// 平手の序盤から飛車交換までの実戦的な手順を app-core の applyMoveWithState で
// 順に指し、直近の移動先の駒だけが着地アニメーションを再生する。
// reduced-motion では初期局面のまま静止する。

export const DEMO_MOVES = [
    "7g7f",
    "3c3d",
    "2g2f",
    "8c8d",
    "2f2e",
    "8d8e",
    "6i7h",
    "4a3b",
    "2e2d",
    "2c2d",
    "2h2d",
] as const;

const STEP_MS = 1500;
const START_DELAY_MS = 1400;
const END_HOLD_MS = 2600;

interface DemoFrame {
    ply: number;
    lastMove: { from: string | null; to: string } | null;
}

const INITIAL_FRAME: DemoFrame = { ply: 0, lastMove: null };

function buildFrames() {
    let state = createInitialPositionState();
    const frames = [{ grid: boardToGrid(state.board), ...INITIAL_FRAME }];
    DEMO_MOVES.forEach((move, i) => {
        const result = applyMoveWithState(state, move);
        if (!result.ok) return;
        state = result.next;
        frames.push({
            grid: boardToGrid(state.board),
            ply: i + 1,
            lastMove: result.lastMove?.to
                ? { from: result.lastMove.from ?? null, to: result.lastMove.to }
                : null,
        });
    });
    return frames;
}

const FRAMES = buildFrames();

interface HeroBoardProps {
    className?: string;
    // 指し手が進むたびに通知する (手数 0 = 初期局面、移動先マス)
    onStep?: (ply: number, to: string | null) => void;
}

export function HeroBoard({ className, onStep }: HeroBoardProps): ReactElement {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const last = FRAMES.length - 1;
        const delay = index === 0 ? START_DELAY_MS : index === last ? END_HOLD_MS : STEP_MS;
        const timer = window.setTimeout(() => setIndex(index === last ? 0 : index + 1), delay);
        return () => window.clearTimeout(timer);
    }, [index]);

    const frame = FRAMES[index];
    useEffect(() => {
        onStep?.(frame.ply, frame.lastMove?.to ?? null);
    }, [frame, onStep]);

    return (
        <div
            inert
            aria-hidden
            className={cn(
                "flex select-none justify-center [--shogi-cell-size:clamp(30px,4vw,40px)]",
                className,
            )}
        >
            <ShogiBoard grid={frame.grid} lastMove={frame.lastMove ?? undefined} />
        </div>
    );
}
