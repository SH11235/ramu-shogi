/**
 * 評価値グラフコンポーネント
 *
 * 横軸に手数、縦軸に評価値を表示する折れ線グラフ
 * 評価値の範囲に応じて自動スケール
 */

import type { MouseEvent, PointerEvent, ReactElement } from "react";
import { useRef } from "react";
import type { EvalHistory } from "../utils/kifFormat";

interface EvalGraphProps {
    /** 評価値の履歴 */
    evalHistory: EvalHistory[];
    /** 現在の手数（マーカー表示用） */
    currentPly: number;
    /** コンパクト表示（スマホ用） */
    compact?: boolean;
    /** グラフの高さ（px） */
    height?: number;
    /** 最小スケール範囲（センチポーン、デフォルト: 500 = ±5歩） */
    minScale?: number;
    /** クリック時のコールバック（既存の拡大表示用） */
    onClick?: () => void;
    /** 手数選択時のコールバック */
    onPlySelect?: (ply: number) => void;
    /**
     * グラフをなぞって手数を選べるようにする（コンパクト表示で `onPlySelect` だけを渡したとき）。
     * 指では狙った 1 手を押せないので、スマホではなぞりながら局面を送る。
     */
    scrubbable?: boolean;
    /**
     * 縦軸の上限（センチポーン）。指定すると、詰みや大差の評価値は上端・下端に張り付けて描き、
     * 縦軸はこの値までの通常の評価値の範囲で決める（最終手の詰みで全体が平らに見えるのを防ぐ）。
     * 省略時は従来どおり。
     */
    axisCap?: number;
    /** グラフに重ねる印（研究ノートの注目局面など）。コンパクト表示でだけ描く。 */
    markers?: readonly EvalGraphMarker[];
    /** 印を押したときのコールバック。省略時は印を押せない（見た目だけ）。 */
    onMarkerSelect?: (marker: EvalGraphMarker) => void;
}

/** 評価値グラフに重ねる印。 */
export interface EvalGraphMarker {
    /** `evalHistory` の添字（0 = 開始局面）。 */
    ply: number;
    /** 印の種類。色だけでなく形でも見分けられるようにしている。 */
    tone: "blunder" | "dubious" | "bookmark";
    /** 読み上げ・ツールチップ用の説明（例: `42手目 悪手`）。 */
    label: string;
}

const MARKER_CLASS: Record<EvalGraphMarker["tone"], string> = {
    // 悪手: 塗りの丸 / 疑問手: 白抜きの丸 / しおり: ひし形
    blunder: "rounded-full bg-study-blunder ring-2 ring-background",
    dubious: "rounded-full border-2 border-study-dubious bg-background",
    bookmark: "rotate-45 bg-wafuu-kin ring-1 ring-wafuu-sumi/60",
};

/**
 * 評価値をY座標に変換（自動スケール対応版）
 */
function evalToYWithScale(
    evalCp: number | null | undefined,
    evalMate: number | null | undefined,
    height: number,
    scaleMax: number,
): number {
    const center = height / 2;
    const margin = 4;

    // 詰みの場合は上端または下端に固定
    if (evalMate !== undefined && evalMate !== null) {
        return evalMate > 0 ? margin : height - margin;
    }

    if (evalCp === undefined || evalCp === null) {
        return center; // 未計算は中央
    }

    // スケール範囲内で正規化
    const clamped = Math.max(-scaleMax, Math.min(scaleMax, evalCp));
    // 正の値は上（Y小）、負の値は下（Y大）
    const normalized = -clamped / scaleMax; // -1 ~ +1
    return center + normalized * (center - margin);
}

/**
 * 適切なスケール値を計算（きれいな数値に丸める）
 */
function computeNiceScale(maxAbsValue: number, minScale: number): number {
    // 最小スケールを保証
    const target = Math.max(maxAbsValue * 1.1, minScale); // 10%マージン

    // きれいな数値に丸める（100, 200, 500, 1000, 2000, 5000, 10000...）
    const niceValues = [100, 200, 500, 1000, 2000, 3000, 5000, 10000, 20000, 50000];
    for (const nice of niceValues) {
        if (nice >= target) {
            return nice;
        }
    }
    return Math.ceil(target / 10000) * 10000;
}

/**
 * 評価値から決める縦軸の上限 (センチポーン)。
 * エンジンによっては詰みや必勝を 31998 のような巨大な評価値で表すので、そのまま縦軸に
 * 使うと他の手の動きが潰れて見えなくなる。評価値がいくら大きくても縦軸はここで止め、
 * 超えた値は上端・下端に張り付けて描く。
 */
const EVAL_GRAPH_AXIS_CAP = 10000;

/** 詰み (evalMate) を含むときに縦軸の計算に使う大きさ。従来からの値。 */
const EVAL_GRAPH_MATE_VALUE = 10000;

/** 評価値の履歴からグラフの縦軸の最大値 (センチポーン) を決める。 */
export function computeEvalGraphScale(
    evalHistory: readonly EvalHistory[],
    minScale: number,
    axisCap?: number,
): number {
    if (axisCap !== undefined) {
        // 上限つき: 上限を超える値と詰みは縦軸の計算に入れない（端に張り付けて描く）。
        let maxWithinCap = 0;
        for (const entry of evalHistory) {
            if (entry.evalCp === null || entry.evalCp === undefined) continue;
            maxWithinCap = Math.max(maxWithinCap, Math.min(Math.abs(entry.evalCp), axisCap));
        }
        return Math.min(computeNiceScale(maxWithinCap, minScale), axisCap);
    }
    let maxAbsCp = 0;
    let hasMate = false;
    for (const entry of evalHistory) {
        if (entry.evalCp !== null && entry.evalCp !== undefined) {
            maxAbsCp = Math.max(maxAbsCp, Math.abs(entry.evalCp));
        }
        if (entry.evalMate !== null && entry.evalMate !== undefined) hasMate = true;
    }
    const cpScale = Math.min(computeNiceScale(maxAbsCp, minScale), EVAL_GRAPH_AXIS_CAP);
    // 詰みを含むグラフは従来どおりの縦軸にする (詰みは上端・下端に固定して描く)。
    return hasMate ? Math.max(cpScale, computeNiceScale(EVAL_GRAPH_MATE_VALUE, minScale)) : cpScale;
}

/**
 * 評価値グラフ
 */
export function EvalGraph({
    evalHistory,
    currentPly,
    compact = false,
    height: customHeight,
    minScale = 500,
    onClick,
    onPlySelect,
    scrubbable = false,
    axisCap,
    markers,
    onMarkerSelect,
}: EvalGraphProps): ReactElement {
    const height = customHeight ?? (compact ? 60 : 80);
    const padding = { top: 4, bottom: 4, left: 0, right: 0 };
    const graphHeight = height - padding.top - padding.bottom;
    const graphContainerRef = useRef<HTMLElement>(null);
    const scrubPointerIdRef = useRef<number | null>(null);

    // 横位置から手数を計算して選ぶ
    const selectPlyAt = (clientX: number) => {
        if (!onPlySelect || evalHistory.length <= 1) return;

        const container = graphContainerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        if (rect.width <= 0) return;
        const x = clientX - rect.left;

        const maxPly = evalHistory.length - 1;
        const clickedPly = Math.round((x / rect.width) * maxPly);
        const clampedPly = Math.max(0, Math.min(maxPly, clickedPly));

        onPlySelect(clampedPly);
    };

    const handleGraphClick = (e: MouseEvent<HTMLDivElement | HTMLButtonElement>) => {
        // キーボード（Enter / Space）からの click は位置を持たない（左端 = 開始局面へ飛んでしまう）。
        if (e.detail === 0) return;
        selectPlyAt(e.clientX);
    };

    // なぞって選ぶ（scrubbable のとき）。押している間、その指の位置の手数を選び続ける。
    // 受け付けるのは最初の 1 本の指（マウスは主ボタン）だけ。
    const endScrub = (e: PointerEvent<HTMLButtonElement>) => {
        if (scrubPointerIdRef.current === e.pointerId) scrubPointerIdRef.current = null;
    };
    const scrubHandlers = scrubbable
        ? {
              onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
                  if (e.button !== 0 || scrubPointerIdRef.current !== null) return;
                  scrubPointerIdRef.current = e.pointerId;
                  // 指がグラフの外へ出ても追い続ける（対応していない環境では、外へ出たら止まるだけ）。
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  selectPlyAt(e.clientX);
              },
              onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
                  if (scrubPointerIdRef.current !== e.pointerId) return;
                  selectPlyAt(e.clientX);
              },
              onPointerUp: endScrub,
              onPointerCancel: endScrub,
              onLostPointerCapture: endScrub,
          }
        : undefined;

    const scaleMax = computeEvalGraphScale(evalHistory, minScale, axisCap);

    // ポイントの計算（先手・後手を分離して別々のセグメントを生成）
    // viewBox="0 0 100 height" なので x は 0-100 の数値、y はピクセル値
    const { senteSegments, goteSegments } = (() => {
        if (evalHistory.length === 0) return { senteSegments: [], goteSegments: [] };

        const maxPly = Math.max(evalHistory.length - 1, 1);
        const sente: string[][] = [];
        const gote: string[][] = [];
        let currentSenteSegment: string[] = [];
        let currentGoteSegment: string[] = [];

        evalHistory.forEach((entry, index) => {
            const hasValue = entry.evalCp !== null || entry.evalMate !== null;
            // ply=0は初期局面（評価値0）、ply奇数は先手の手、ply偶数は後手の手
            const isSenteMove =
                entry.mover !== undefined ? entry.mover === "sente" : entry.ply % 2 === 1;

            if (hasValue) {
                const x = (index / maxPly) * 100;
                const y =
                    padding.top +
                    evalToYWithScale(entry.evalCp, entry.evalMate, graphHeight, scaleMax);
                const point = `${x},${y}`;

                if (index === 0) {
                    // 初期局面（ply=0）は両方に追加
                    currentSenteSegment.push(point);
                    currentGoteSegment.push(point);
                } else if (isSenteMove) {
                    currentSenteSegment.push(point);
                } else {
                    currentGoteSegment.push(point);
                }
            } else {
                // null値で区切り
                if (index === 0 || isSenteMove) {
                    if (currentSenteSegment.length > 0) {
                        sente.push(currentSenteSegment);
                        currentSenteSegment = [];
                    }
                }
                if (index === 0 || !isSenteMove) {
                    if (currentGoteSegment.length > 0) {
                        gote.push(currentGoteSegment);
                        currentGoteSegment = [];
                    }
                }
            }
        });

        // 最後のセグメントを追加
        if (currentSenteSegment.length > 0) {
            sente.push(currentSenteSegment);
        }
        if (currentGoteSegment.length > 0) {
            gote.push(currentGoteSegment);
        }

        return { senteSegments: sente, goteSegments: gote };
    })();

    // 現在位置のマーカー
    const currentMarker = (() => {
        if (currentPly < 0 || currentPly >= evalHistory.length) return null;

        const maxPly = Math.max(evalHistory.length - 1, 1);
        const entry = evalHistory[currentPly];
        const x = (currentPly / maxPly) * 100;
        const y =
            padding.top + evalToYWithScale(entry?.evalCp, entry?.evalMate, graphHeight, scaleMax);

        return { x, y };
    })();

    // Y軸の目盛り値（棋譜の評価値と同じく、センチポーンをそのまま出す）
    const yAxisLabels = (() => {
        const displayMax = scaleMax;
        const halfValue = displayMax / 2;
        return [
            { value: `+${displayMax}`, position: padding.top },
            { value: `+${halfValue.toFixed(0)}`, position: padding.top + graphHeight / 4 },
            { value: "0", position: padding.top + graphHeight / 2 },
            { value: `-${halfValue.toFixed(0)}`, position: padding.top + (graphHeight * 3) / 4 },
            { value: `-${displayMax}`, position: padding.top + graphHeight },
        ];
    })();

    // X軸の目盛り（手数）
    const xAxisLabels = (() => {
        const maxPly = Math.max(evalHistory.length - 1, 1);
        if (maxPly <= 10) {
            return [0, maxPly];
        }
        if (maxPly <= 50) {
            const mid = Math.round(maxPly / 2);
            return [0, mid, maxPly];
        }
        // 50手以上の場合は4分割
        const quarter = Math.round(maxPly / 4);
        return [0, quarter, quarter * 2, quarter * 3, maxPly];
    })();

    if (compact) {
        // コンパクト表示用のSVGコンテンツ
        const compactSvg = (
            <svg
                width="100%"
                height={height}
                className="block"
                viewBox={`0 0 100 ${height}`}
                preserveAspectRatio="none"
                role="img"
                aria-label="評価値推移グラフ"
            >
                {/* 水平グリッド線 */}
                {yAxisLabels.map((label) => (
                    <line
                        key={`grid-${label.value}`}
                        x1="0%"
                        y1={label.position}
                        x2="100%"
                        y2={label.position}
                        stroke="hsl(var(--border))"
                        strokeWidth={label.value === "0" ? "1" : "0.5"}
                        vectorEffect="non-scaling-stroke"
                        strokeDasharray={label.value === "0" ? "none" : "2,2"}
                    />
                ))}

                {/* 評価値ライン（先手：朱色） */}
                {senteSegments.map((segment) => (
                    <polyline
                        key={`sente-${segment[0]}`}
                        points={segment.join(" ")}
                        fill="none"
                        stroke="hsl(var(--wafuu-shu))"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                    />
                ))}

                {/* 評価値ライン（後手：藍色） */}
                {goteSegments.map((segment) => (
                    <polyline
                        key={`gote-${segment[0]}`}
                        points={segment.join(" ")}
                        fill="none"
                        stroke="hsl(var(--wafuu-ai))"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                    />
                ))}

                {/* 現在位置マーカー（縦線）。金は明地でコントラストが弱いため、
                    下層に墨のアウトラインを敷いて両テーマで視認性を確保する */}
                {currentMarker && (
                    <g>
                        <line
                            x1={currentMarker.x}
                            y1={padding.top}
                            x2={currentMarker.x}
                            y2={padding.top + graphHeight}
                            stroke="hsl(var(--wafuu-sumi))"
                            strokeWidth="4"
                            vectorEffect="non-scaling-stroke"
                        />
                        <line
                            x1={currentMarker.x}
                            y1={padding.top}
                            x2={currentMarker.x}
                            y2={padding.top + graphHeight}
                            stroke="hsl(var(--wafuu-kin))"
                            strokeWidth="2"
                            vectorEffect="non-scaling-stroke"
                        />
                    </g>
                )}
            </svg>
        );

        // コンパクト表示の内部コンテンツ
        const compactContent = (
            <>
                {/* Y軸ラベル */}
                {yAxisLabels
                    .filter((_, i) => i % 2 === 0) // 上・中・下の3つだけ表示
                    .map((label) => (
                        <span
                            key={label.value}
                            className="absolute left-0 font-mono text-[10px] text-muted-foreground tabular-nums -translate-y-1/2 w-7 text-right pr-1"
                            style={{ top: label.position }}
                        >
                            {label.value}
                        </span>
                    ))}

                {/* グラフ本体 */}
                {/* onClickがある場合は拡大を優先（手数選択は拡大後のモーダルで） */}
                {/* onPlySelectのみの場合は手数選択 */}
                {onClick ? (
                    <button
                        ref={(el) => {
                            (
                                graphContainerRef as React.MutableRefObject<HTMLElement | null>
                            ).current = el;
                        }}
                        type="button"
                        className="ml-8 bg-transparent border-0 p-0 block text-left w-[calc(100%-32px)] cursor-pointer"
                        style={{ height }}
                        onClick={onClick}
                        aria-label="評価値グラフを拡大表示"
                        title="クリックで拡大"
                    >
                        {compactSvg}
                    </button>
                ) : onPlySelect ? (
                    <button
                        ref={(el) => {
                            (
                                graphContainerRef as React.MutableRefObject<HTMLElement | null>
                            ).current = el;
                        }}
                        type="button"
                        className={`ml-8 bg-transparent border-0 p-0 block text-left w-[calc(100%-32px)] cursor-crosshair ${scrubbable ? "touch-none" : ""}`}
                        style={{ height }}
                        onClick={handleGraphClick}
                        {...scrubHandlers}
                        aria-label="グラフをクリックして手数を選択"
                    >
                        {compactSvg}
                    </button>
                ) : (
                    <div
                        ref={(el) => {
                            (
                                graphContainerRef as React.MutableRefObject<HTMLElement | null>
                            ).current = el;
                        }}
                        className="ml-8"
                        style={{ height }}
                    >
                        {compactSvg}
                    </div>
                )}

                {/* X軸ラベル（手数） */}
                <div className="flex justify-between ml-8 mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {xAxisLabels.map((ply) => (
                        <span key={ply}>{ply}手</span>
                    ))}
                </div>
            </>
        );

        // 印（注目局面など）。SVG は横に引き伸ばして描くので、形が歪まないよう HTML で重ねる。
        const maxPlyForMarkers = Math.max(evalHistory.length - 1, 1);
        const markerOverlay =
            markers && markers.length > 0 ? (
                <div
                    className="pointer-events-none absolute left-8 right-0 top-0"
                    style={{ height }}
                >
                    {markers
                        .filter((marker) => marker.ply >= 0 && marker.ply < evalHistory.length)
                        .map((marker) => {
                            const entry = evalHistory[marker.ply];
                            const style = {
                                left: `${(marker.ply / maxPlyForMarkers) * 100}%`,
                                top:
                                    padding.top +
                                    evalToYWithScale(
                                        entry?.evalCp,
                                        entry?.evalMate,
                                        graphHeight,
                                        scaleMax,
                                    ),
                            };
                            const shapeClass = `block h-2.5 w-2.5 ${MARKER_CLASS[marker.tone]}`;
                            const key = `${marker.tone}-${marker.ply}`;
                            return onMarkerSelect ? (
                                <button
                                    key={key}
                                    type="button"
                                    className="pointer-events-auto absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center border-0 bg-transparent p-0"
                                    style={style}
                                    onClick={() => onMarkerSelect(marker)}
                                    aria-label={`${marker.label}へ移動`}
                                    title={marker.label}
                                >
                                    <span className={shapeClass} />
                                </button>
                            ) : (
                                <span
                                    key={key}
                                    className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                                    style={style}
                                    title={marker.label}
                                >
                                    <span className={shapeClass} />
                                </span>
                            );
                        })}
                </div>
            ) : null;

        // グラフ本体にボタンがあるので、外側は常にdiv
        return (
            <div className="relative w-full">
                {compactContent}
                {markerOverlay}
            </div>
        );
    }

    // 通常表示
    const displayMax = scaleMax;

    // SVGグラフコンテンツ
    const graphSvg = (
        <svg
            width="100%"
            height={height}
            className="block"
            viewBox={`0 0 100 ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="評価値推移グラフ"
        >
            {/* 背景グリッド */}
            <line
                x1="0%"
                y1={padding.top}
                x2="100%"
                y2={padding.top}
                stroke="hsl(var(--border))"
                strokeWidth="0.5"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="2,2"
            />
            <line
                x1="0%"
                y1={padding.top + graphHeight}
                x2="100%"
                y2={padding.top + graphHeight}
                stroke="hsl(var(--border))"
                strokeWidth="0.5"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="2,2"
            />

            {/* 中央線（0評価） */}
            <line
                x1="0%"
                y1={padding.top + graphHeight / 2}
                x2="100%"
                y2={padding.top + graphHeight / 2}
                stroke="hsl(var(--border))"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
            />

            {/* 評価値ライン（先手：朱色） */}
            {senteSegments.map((segment) => (
                <polyline
                    key={`sente-${segment[0]}`}
                    points={segment.join(" ")}
                    fill="none"
                    stroke="hsl(var(--wafuu-shu))"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                />
            ))}

            {/* 評価値ライン（後手：藍色） */}
            {goteSegments.map((segment) => (
                <polyline
                    key={`gote-${segment[0]}`}
                    points={segment.join(" ")}
                    fill="none"
                    stroke="hsl(var(--wafuu-ai))"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                />
            ))}

            {/* 現在位置マーカー（縦線）。金は明地でコントラストが弱いため、
                下層に墨のアウトラインを敷いて両テーマで視認性を確保する */}
            {currentMarker && (
                <g>
                    <line
                        x1={currentMarker.x}
                        y1={padding.top}
                        x2={currentMarker.x}
                        y2={padding.top + graphHeight}
                        stroke="hsl(var(--wafuu-sumi))"
                        strokeWidth="4"
                        vectorEffect="non-scaling-stroke"
                    />
                    <line
                        x1={currentMarker.x}
                        y1={padding.top}
                        x2={currentMarker.x}
                        y2={padding.top + graphHeight}
                        stroke="hsl(var(--wafuu-kin))"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                    />
                </g>
            )}
        </svg>
    );

    // 外側のコンテナ（onClick用）
    const outerContent = (
        <>
            <div className="flex justify-between items-center mb-1.5">
                <span className="font-bold text-sm">評価値推移</span>
                {/* 拡大ボタン（onPlySelectとonClickの両方がある場合） */}
                {onPlySelect && onClick && (
                    <button
                        type="button"
                        className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors"
                        onClick={onClick}
                        aria-label="評価値グラフを拡大表示"
                        title="拡大表示"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M15 3h6v6M14 10l6.1-6.1M9 21H3v-6M10 14l-6.1 6.1" />
                        </svg>
                    </button>
                )}
            </div>
            <div className="relative w-full" style={{ height }}>
                {/* 左側ラベル */}
                <span
                    className="absolute font-mono text-[10px] text-muted-foreground tabular-nums left-0 -translate-y-1/2"
                    style={{ top: padding.top }}
                >
                    +{displayMax}
                </span>
                <span
                    className="absolute font-mono text-[10px] text-muted-foreground tabular-nums left-0 -translate-y-1/2"
                    style={{ top: padding.top + graphHeight / 2 }}
                >
                    0
                </span>
                <span
                    className="absolute font-mono text-[10px] text-muted-foreground tabular-nums left-0 translate-y-1/2"
                    style={{ bottom: padding.bottom }}
                >
                    -{displayMax}
                </span>

                {/* グラフ本体（クリック可能領域） */}
                {onPlySelect ? (
                    <button
                        ref={(el) => {
                            (
                                graphContainerRef as React.MutableRefObject<HTMLElement | null>
                            ).current = el;
                        }}
                        type="button"
                        className="ml-5 bg-transparent border-0 p-0 block text-left w-[calc(100%-20px)] cursor-crosshair"
                        style={{ height }}
                        onClick={handleGraphClick}
                        aria-label="グラフをクリックして手数を選択"
                    >
                        {graphSvg}
                    </button>
                ) : (
                    <div
                        ref={(el) => {
                            (
                                graphContainerRef as React.MutableRefObject<HTMLElement | null>
                            ).current = el;
                        }}
                        className="ml-5 w-[calc(100%-20px)]"
                        style={{ height }}
                    >
                        {graphSvg}
                    </div>
                )}
            </div>

            {/* 手数表示 */}
            <div className="flex justify-between mt-1 ml-5">
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">0</span>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                    {Math.max(evalHistory.length - 1, 0)}手
                </span>
            </div>
        </>
    );

    // onPlySelectがある場合は内部にボタンがあるため、外側はdivにする
    // onPlySelectがなくonClickのみの場合は外側をボタンにする
    if (onPlySelect) {
        // 内部にボタンがあるので外側はdiv
        return (
            <div className="bg-card border border-border rounded-xl p-3 shadow-lg w-[var(--panel-width)]">
                {outerContent}
            </div>
        );
    }

    if (onClick) {
        return (
            <button
                type="button"
                className="bg-card border border-border rounded-xl p-3 shadow-lg w-[var(--panel-width)] text-left cursor-pointer"
                onClick={onClick}
                aria-label="評価値グラフを拡大表示"
            >
                {outerContent}
            </button>
        );
    }

    return (
        <div className="bg-card border border-border rounded-xl p-3 shadow-lg w-[var(--panel-width)]">
            {outerContent}
        </div>
    );
}
