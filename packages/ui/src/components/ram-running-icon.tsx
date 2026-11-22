import { cn } from "@shogi/design-system";
import type { CSSProperties, ReactElement } from "react";

/**
 * 走るラム（トイプードル）のドット絵。6 コマを横に並べた 1 枚の絵を、窓の中で 1 コマずつ送って動かす。
 * 動きを減らす設定の端末では、最初のコマで止める。
 *
 * 1 文字が 1 ドット: F = 毛、D = 毛の陰（向こう側の脚・耳）、C = 口元、K = 目・鼻、B = 首輪。
 * 前脚で支える → 脚を胴の下に集める → 後ろ脚で支える → 後ろ脚で蹴る → 跳ねる → 前脚が着く、の順。
 * 止めたときに出す最初のコマは、足が地に着いた姿にする。
 * その場で走らせるので、着いている足は 1 コマごとに約 3 ドットずつ後ろへ送る（滑って見えないように）。
 */
const FRAMES: readonly (readonly string[])[] = [
    [
        "....................",
        "............FFF.....",
        "...........FFFFF....",
        ".FF.......DFFFKFC...",
        "FFF.......DDFFFFCCK.",
        ".FFF......DDFFFCC...",
        "....FFFFFFDDBBF.....",
        ".....FFFFFFFFFFF....",
        ".....FFFFFFFFFFF....",
        "......FFDDDDFF......",
        "......FF.D...FFD....",
        ".......FF.DD..F.D...",
        "........FF....F.D...",
        ".............FF..DD.",
    ],
    [
        "....................",
        "............FFF.....",
        "...........FFFFF....",
        ".FF.......DFFFKFC...",
        "FFF.......DDFFFFCCK.",
        ".FFF......DDFFFCC...",
        "....FFFFFFDDBBF.....",
        ".....FFFFFFFFFFF....",
        ".....FFFFFFFFFFF....",
        "......FFDDDDFF......",
        "......FF.DD..FF.....",
        ".......FF..DFFD.....",
        "........FF.FF.D.....",
        ".........FF...DD....",
    ],
    [
        "....................",
        "............FFF.....",
        ".FF........FFFFF....",
        "FFF.......DFFFKFC...",
        ".FFF......DDFFFFCCK.",
        "....F.....DDFFFCC...",
        ".....FFFFFDDBBF.....",
        ".....FFFFFFFFFFF....",
        ".....FFFFFFFFFFF....",
        "......FFDDDDFF......",
        "......FFD...DFF.....",
        "......FF.D.DD.FF....",
        "......FF.D.....F....",
        "......FFF.DD........",
    ],
    [
        "............FFF.....",
        ".FF.......DFFFFF....",
        "FFF......DDFFFKFC...",
        ".FFF......DFFFFFCCK.",
        "....F......FFFFCC...",
        ".....FFFFFFFBBF.....",
        ".....FFFFFFFFFFF....",
        ".....FFFFFFFFFFF....",
        "......FFDDDDFF......",
        "......FFD...DFFF....",
        "......FFD...DD.FFF..",
        ".....FF.D...........",
        "....FF.D............",
        "...FF..DD...........",
    ],
    [
        "............FFF.....",
        ".FF.......DFFFFF....",
        "FFF......DDFFFKFC...",
        ".FFF......DFFFFFCCK.",
        "....F......FFFFCC...",
        ".....FFFFFFFBBF.....",
        ".....FFFFFFFFFFF....",
        ".....FFFFFFFFFFF....",
        "......FFDDDDFF......",
        "......FFD...D.FF....",
        ".....FFD.....DDFF...",
        "...FFFD.......DDFFF.",
        "....................",
        "....................",
    ],
    [
        "....................",
        "............FFF.....",
        ".FF........FFFFF....",
        "FFF.......DFFFKFC...",
        ".FFF......DDFFFFCCK.",
        "....F.....DDFFFCC...",
        ".....FFFFFDDBBF.....",
        ".....FFFFFFFFFFF....",
        ".....FFFFFFFFFFF....",
        "......FFDDDDFF.DD...",
        "......FFD....FF..D..",
        ".......FF.....FF....",
        ".........D.....FF...",
        "................FF..",
    ],
];
const DOT_WIDTH = FRAMES[0][0].length;
const DOT_HEIGHT = FRAMES[0].length;

const DOT_CLASS: Record<string, string> = {
    F: "fill-ram-fur",
    D: "fill-ram-fur-deep",
    C: "fill-ram-cream",
    K: "fill-ram-ink",
    B: "fill-wafuu-ai",
};

// 同じ色が横に続くドットは 1 つの矩形にまとめる（矩形の数を減らし、境目の隙間も出さない）。
const SHEET_RECTS = FRAMES.flatMap((frame, index) =>
    frame.flatMap((row, y) => {
        const rects: { x: number; y: number; width: number; className: string }[] = [];
        let x = 0;
        while (x < row.length) {
            const className = DOT_CLASS[row[x]];
            let end = x + 1;
            while (end < row.length && row[end] === row[x]) end++;
            if (className) {
                rects.push({ x: index * DOT_WIDTH + x, y, width: end - x, className });
            }
            x = end;
        }
        return rects;
    }),
);

export function RamRunningIcon({
    dotSize = 2,
    running = true,
    className,
}: {
    /** 1 ドットの大きさ（px）。 */
    dotSize?: number;
    /** false なら止まった絵（最初のコマ）にする。 */
    running?: boolean;
    className?: string;
}): ReactElement {
    const width = DOT_WIDTH * dotSize;
    const height = DOT_HEIGHT * dotSize;
    return (
        <span
            aria-hidden="true"
            className={cn("inline-block shrink-0 overflow-hidden", className)}
            style={{ width, height } as CSSProperties}
        >
            <svg
                aria-hidden="true"
                viewBox={`0 0 ${DOT_WIDTH * FRAMES.length} ${DOT_HEIGHT}`}
                width={width * FRAMES.length}
                height={height}
                shapeRendering="crispEdges"
                className={cn("block", running && "animate-ram-run motion-reduce:animate-none")}
            >
                {SHEET_RECTS.map((rect) => (
                    <rect
                        key={`${rect.x}:${rect.y}`}
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={1}
                        className={rect.className}
                    />
                ))}
            </svg>
        </span>
    );
}
