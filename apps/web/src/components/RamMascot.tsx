import { cn } from "@shogi/design-system";
import { type ReactElement, useEffect, useId, useRef } from "react";
import { usePrefersReducedMotion } from "../lib/usePrefersReducedMotion";

// マスコットのラム。favicon と同じ造形 (モコモコのドーム + 垂れ耳 + 水色の首輪) を
// 大きく描き、ポインタを目で追う・まばたき・耳のゆれを付けた。
// 動きは CSS 変数 (--look-x/--look-y, 単位は SVG 座標) と @keyframes だけで駆動し、
// ポインタ追従は rAF で 1 フレームに 1 回だけ反映する。reduced-motion では静止画。

interface RamMascotProps {
    className?: string;
    // true の間は上目づかい (エンジンが思考中などの待ち状態)
    thinking?: boolean;
    // false で目の追従とまばたきを止める (小さい表示用)
    animated?: boolean;
    // worried: エラー画面向けの困り顔 (眉を下げ、口をへの字に)
    mood?: "happy" | "worried";
    // 視線を向ける画面座標。ポインタが動くまで、または次の gaze が来るまで保持する
    gaze?: { x: number; y: number } | null;
    // true で支援技術から隠す。近くに同じ内容のテキストがある場面 (ロゴ・通知の見出し) 用
    decorative?: boolean;
}

const EYE_TRAVEL = 3.2;

export function RamMascot({
    className,
    thinking = false,
    animated = true,
    mood = "happy",
    gaze = null,
    decorative = false,
}: RamMascotProps): ReactElement {
    const rootRef = useRef<SVGSVGElement>(null);
    // 同じページに複数描画されるため、グラデーション id は個体ごとに一意にする
    const furLightId = useId();
    const reducedMotion = usePrefersReducedMotion();

    useEffect(() => {
        const root = rootRef.current;
        if (!animated || reducedMotion || !root) return;

        let frame = 0;
        let target: { x: number; y: number } | null = gaze;
        const apply = () => {
            frame = 0;
            if (!target) return;
            const rect = root.getBoundingClientRect();
            const dx = target.x - (rect.left + rect.width / 2);
            const dy = target.y - (rect.top + rect.height * 0.5);
            const dist = Math.hypot(dx, dy) || 1;
            // 遠いほど視線は端まで振れ、近いと穏やかに中央へ寄る
            const k = Math.min(1, dist / 260);
            root.style.setProperty("--look-x", `${((dx / dist) * EYE_TRAVEL * k).toFixed(2)}px`);
            root.style.setProperty("--look-y", `${((dy / dist) * EYE_TRAVEL * k).toFixed(2)}px`);
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(apply);
        };
        const onMove = (e: PointerEvent) => {
            target = { x: e.clientX, y: e.clientY };
            schedule();
        };
        schedule();
        window.addEventListener("pointermove", onMove, { passive: true });
        return () => {
            window.removeEventListener("pointermove", onMove);
            if (frame) cancelAnimationFrame(frame);
        };
    }, [animated, reducedMotion, gaze]);

    return (
        <svg
            ref={rootRef}
            viewBox="0 0 128 128"
            {...(decorative
                ? { "aria-hidden": true }
                : { role: "img", "aria-label": "トイプードルのラム" })}
            className={cn("ram-mascot overflow-visible", className)}
            data-thinking={thinking || undefined}
            data-animated={animated || undefined}
        >
            <title>ラム</title>
            <defs>
                <radialGradient id={furLightId} cx="42%" cy="28%" r="75%">
                    <stop offset="0%" stopColor="hsl(var(--ram-cream))" stopOpacity="0.55" />
                    <stop offset="60%" stopColor="hsl(var(--ram-fur))" stopOpacity="0" />
                </radialGradient>
            </defs>

            {/* 首・胸元 */}
            <rect x="46" y="100" width="36" height="18" rx="6" className="fill-ram-fur-deep" />
            <rect x="46" y="100" width="36" height="14" rx="6" className="fill-ram-fur" />
            {/* 首輪 */}
            <rect x="40" y="111" width="48" height="10" rx="5" className="fill-ram-collar" />
            <rect
                x="40"
                y="111"
                width="48"
                height="4"
                rx="2"
                className="fill-glint"
                opacity="0.35"
            />
            <rect x="60" y="109.5" width="9" height="13" rx="3.5" className="fill-ram-collar" />
            <rect
                x="60"
                y="109.5"
                width="9"
                height="13"
                rx="3.5"
                className="fill-glint"
                opacity="0.28"
            />
            <circle cx="64.5" cy="116" r="1.6" className="fill-glint" opacity="0.9" />

            {/* 垂れ耳 */}
            <g className="ram-ear ram-ear-l">
                <g className="fill-ram-fur">
                    <circle cx="28" cy="46" r="12" />
                    <circle cx="23" cy="58" r="11" />
                    <circle cx="22" cy="70" r="10.5" />
                    <circle cx="27" cy="80" r="9.5" />
                </g>
                <ellipse cx="27" cy="63" rx="8" ry="17" className="fill-ram-fur-deep" />
            </g>
            <g className="ram-ear ram-ear-r">
                <g className="fill-ram-fur">
                    <circle cx="100" cy="46" r="12" />
                    <circle cx="105" cy="58" r="11" />
                    <circle cx="106" cy="70" r="10.5" />
                    <circle cx="101" cy="80" r="9.5" />
                </g>
                <ellipse cx="101" cy="63" rx="8" ry="17" className="fill-ram-fur-deep" />
            </g>

            <g className="ram-head">
                {/* 頭頂ドーム */}
                <g className="fill-ram-fur">
                    <circle cx="64" cy="42" r="28" />
                    <circle cx="42" cy="36" r="12" />
                    <circle cx="52" cy="27" r="12" />
                    <circle cx="64" cy="24" r="12" />
                    <circle cx="76" cy="27" r="12" />
                    <circle cx="86" cy="36" r="12" />
                </g>
                {/* 顔 */}
                <ellipse cx="64" cy="72" rx="35" ry="36" className="fill-ram-fur" />
                <ellipse cx="64" cy="64" rx="48" ry="52" fill={`url(#${furLightId})`} />

                {/* カールの筆線 */}
                <g
                    fill="none"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    opacity="0.5"
                    className="stroke-ram-fur-deep"
                >
                    <path d="M50 32 q6 -6 12 0" />
                    <path d="M68 29 q6 -5 11 1" />
                    <path d="M42 45 q5 -5 10 0" />
                    <path d="M78 43 q5 -4 10 1" />
                </g>

                {/* 頬 */}
                <ellipse
                    cx="40"
                    cy="78"
                    rx="7"
                    ry="4.5"
                    className="fill-ram-blush"
                    opacity="0.55"
                />
                <ellipse
                    cx="88"
                    cy="78"
                    rx="7"
                    ry="4.5"
                    className="fill-ram-blush"
                    opacity="0.55"
                />

                {/* マズル */}
                <ellipse cx="64" cy="90" rx="18" ry="13" className="fill-ram-cream" />

                {/* 目 */}
                <g className="ram-eye">
                    <ellipse cx="50" cy="63" rx="6.5" ry="6.5" className="fill-ram-ink ram-lid" />
                    <circle cx="52.2" cy="60.8" r="1.9" className="ram-glint fill-glint" />
                    <circle cx="48.2" cy="65.6" r="0.9" className="fill-glint" opacity="0.7" />
                </g>
                <g className="ram-eye">
                    <ellipse cx="78" cy="63" rx="6.5" ry="6.5" className="fill-ram-ink ram-lid" />
                    <circle cx="80.2" cy="60.8" r="1.9" className="ram-glint fill-glint" />
                    <circle cx="76.2" cy="65.6" r="0.9" className="fill-glint" opacity="0.7" />
                </g>

                {/* 鼻 */}
                <path
                    d="M56 83 Q64 78.5 72 83 Q72 90.5 64 93.5 Q56 90.5 56 83 Z"
                    className="fill-ram-ink"
                />
                <ellipse cx="62" cy="83" rx="2.6" ry="1.1" className="fill-glint" opacity="0.4" />
                {/* 口 */}
                <path
                    d={
                        mood === "worried"
                            ? "M64 93.5 V96 M64 96 Q59.5 93.5 56.5 97.5 M64 96 Q68.5 93.5 71.5 97.5"
                            : "M64 93.5 V96.5 M64 96.5 Q59.5 100 56.5 97 M64 96.5 Q68.5 100 71.5 97"
                    }
                    fill="none"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    className="stroke-ram-ink"
                />
                {mood === "worried" && (
                    <g
                        fill="none"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        className="stroke-ram-fur-deep"
                    >
                        <path d="M43 52 L56 49" />
                        <path d="M85 52 L72 49" />
                    </g>
                )}
            </g>
        </svg>
    );
}
