import type { PieceType } from "@shogi/app-core";
import type { ReactElement } from "react";
import { getPieceImagePath } from "./shogi-match/utils/constants";

/** 盤に重ねて示す手（候補手など）。 */
export interface ShogiBoardArrow {
    /** 動かす駒のマス。駒打ちは null。 */
    from: string | null;
    to: string;
    /** 指す側。矢印の色は指す側の色（先手 = 朱、後手 = 藍）。 */
    side: "sente" | "gote";
    /** primary は太く濃く、secondary は細く薄く描く。 */
    emphasis: "primary" | "secondary";
    /** 駒打ちのときの駒。行き先に薄く描く。 */
    dropPiece?: PieceType;
}

const FILES = "987654321";
const RANKS = "abcdefghi";

/** マスの中心（盤の左上を 0、1 マスを 1 とする座標）。読めないマスは null。 */
function centerOf(square: string, flip: boolean): [number, number] | null {
    const column = FILES.indexOf(square[0]);
    const row = RANKS.indexOf(square[1]);
    if (square.length !== 2 || column < 0 || row < 0) return null;
    return flip ? [8 - column + 0.5, 8 - row + 0.5] : [column + 0.5, row + 0.5];
}

const STYLE = {
    primary: { width: 0.24, opacity: 0.8 },
    secondary: { width: 0.15, opacity: 0.45 },
} as const;

function arrowPath(from: [number, number], to: [number, number], width: number): string {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;
    const head = Math.min(width * 2.4, length * 0.6);
    const headHalf = width * 1.25;
    const half = width / 2;
    // 動かす駒の文字を隠しすぎないよう、駒の中心から少し離して描き始める。
    const sx = from[0] + ux * 0.18;
    const sy = from[1] + uy * 0.18;
    const bx = to[0] - ux * head;
    const by = to[1] - uy * head;
    const points: Array<[number, number]> = [
        [sx + nx * half, sy + ny * half],
        [bx + nx * half, by + ny * half],
        [bx + nx * headHalf, by + ny * headHalf],
        to,
        [bx - nx * headHalf, by - ny * headHalf],
        [bx - nx * half, by - ny * half],
        [sx - nx * half, sy - ny * half],
    ];
    return `M${points.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join(" L")} Z`;
}

/**
 * 盤のマス目の上に重ねる矢印。クリック・ドラッグは下のマスへ素通しにする。
 * 第二候補を先に描き、第一候補が上に重なるようにする。
 */
export function ShogiBoardArrows({
    arrows,
    flipBoard,
}: {
    arrows: readonly ShogiBoardArrow[];
    flipBoard: boolean;
}): ReactElement | null {
    if (arrows.length === 0) return null;
    const ordered = [...arrows].sort((a, b) =>
        a.emphasis === b.emphasis ? 0 : a.emphasis === "secondary" ? -1 : 1,
    );
    return (
        <svg
            aria-hidden="true"
            data-testid="shogi-board-arrows"
            viewBox="0 0 9 9"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        >
            {ordered.map((arrow) => {
                const to = centerOf(arrow.to, flipBoard);
                if (!to) return null;
                const { width, opacity } = STYLE[arrow.emphasis];
                const sente = arrow.side === "sente";
                const key = `${arrow.from ?? arrow.dropPiece}-${arrow.to}-${arrow.emphasis}`;
                if (arrow.from === null) {
                    // 駒打ちは駒台の位置が画面の幅で変わるので、矢印にせず行き先に駒の影と輪を描く。
                    const image = arrow.dropPiece
                        ? getPieceImagePath(arrow.side, arrow.dropPiece, false)
                        : null;
                    const upsideDown = flipBoard ? arrow.side === "sente" : arrow.side === "gote";
                    return (
                        <g key={key} data-arrow={arrow.emphasis} data-drop="">
                            {image && (
                                <image
                                    href={image}
                                    x={to[0] - 0.45}
                                    y={to[1] - 0.45}
                                    width={0.9}
                                    height={0.9}
                                    opacity={0.32}
                                    transform={
                                        upsideDown ? `rotate(180 ${to[0]} ${to[1]})` : undefined
                                    }
                                />
                            )}
                            <circle
                                cx={to[0]}
                                cy={to[1]}
                                r={0.42}
                                fill="none"
                                strokeWidth={width * 0.45}
                                strokeOpacity={opacity}
                                className={sente ? "stroke-wafuu-shu" : "stroke-wafuu-ai"}
                            />
                        </g>
                    );
                }
                const from = centerOf(arrow.from, flipBoard);
                if (!from) return null;
                return (
                    <path
                        key={key}
                        data-arrow={arrow.emphasis}
                        d={arrowPath(from, to, width)}
                        fillOpacity={opacity}
                        className={sente ? "fill-wafuu-shu" : "fill-wafuu-ai"}
                    />
                );
            })}
        </svg>
    );
}
