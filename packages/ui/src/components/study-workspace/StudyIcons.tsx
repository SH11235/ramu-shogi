/**
 * 研究ノートの画面で使うアイコン。
 *
 * このアプリはアイコンのライブラリを持たず、既存の画面もインライン SVG で描いているので、
 * それに合わせる。すべて装飾扱い（`aria-hidden`）にし、意味はボタンのラベルで伝える。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";

interface IconProps {
    className?: string;
}

function StrokeIcon({
    className,
    children,
    filled = false,
}: IconProps & { children: ReactNode; filled?: boolean }): ReactElement {
    return (
        <svg
            className={cn("h-4 w-4 shrink-0", className)}
            viewBox="0 0 24 24"
            fill={filled ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

/** しおり。`filled` で付いている状態。 */
export function BookmarkIcon({
    className,
    filled,
}: IconProps & { filled?: boolean }): ReactElement {
    return (
        <StrokeIcon className={className} filled={filled}>
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" />
        </StrokeIcon>
    );
}

/** コメント。 */
export function CommentIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
        </StrokeIcon>
    );
}

/** 盤面の反転。 */
export function FlipIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="M7 4v16M7 4 3.5 7.5M7 4l3.5 3.5M17 20V4M17 20l-3.5-3.5M17 20l3.5-3.5" />
        </StrokeIcon>
    );
}

/** 解析（虫めがね）。 */
export function AnalyzeIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.8-3.8M8.5 11h5M11 8.5v5" />
        </StrokeIcon>
    );
}

/** 解析の設定（つまみ）。 */
export function SettingsIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
            <circle cx="15" cy="7" r="2" />
            <circle cx="9" cy="17" r="2" />
        </StrokeIcon>
    );
}

/** 変化（枝分かれ）。 */
export function BranchIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <circle cx="6" cy="5" r="2" />
            <circle cx="6" cy="19" r="2" />
            <circle cx="18" cy="9" r="2" />
            <path d="M6 7v10M18 11c0 4-6 3-10 6" />
        </StrokeIcon>
    );
}

/** 変化として足す（枝 + 足す）。 */
export function AddBranchIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <circle cx="6" cy="5" r="2" />
            <circle cx="6" cy="19" r="2" />
            <path d="M6 7v10M6 13c0-3 4-4 7-4M17 5v8M13 9h8" />
        </StrokeIcon>
    );
}

/** 削除。 */
export function TrashIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
        </StrokeIcon>
    );
}

/** クラウドに保存済み。 */
export function CloudCheckIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5a3.75 3.75 0 0 1-.5 7.5H7z" />
            <path d="m9.5 13 2 2 3.5-3.5" />
        </StrokeIcon>
    );
}

/** 送信待ち（クラウドへ）。 */
export function CloudUploadIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5a3.75 3.75 0 0 1-.5 7.5" />
            <path d="M12 20v-7M9.5 15.5 12 13l2.5 2.5" />
        </StrokeIcon>
    );
}

/** このブラウザに保存（端末）。 */
export function DeviceIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <rect x="3" y="4" width="18" height="12" rx="1.5" />
            <path d="M8 20h8M12 16v4" />
        </StrokeIcon>
    );
}

/** 注意。 */
export function AlertIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="M12 3 2.5 20h19L12 3zM12 10v4.5M12 17.5v.01" />
        </StrokeIcon>
    );
}

/** 読み筋を盤で見る（再生）。 */
export function PlayIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="M7 4.5v15l12-7.5-12-7.5z" />
        </StrokeIcon>
    );
}

/** 最初の局面へ。 */
export function FirstIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="M6 5v14M19 5l-9 7 9 7V5z" />
        </StrokeIcon>
    );
}

/** 1 手戻る。 */
export function PrevIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="m15 5-8 7 8 7" />
        </StrokeIcon>
    );
}

/** 1 手進む。 */
export function NextIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="m9 5 8 7-8 7" />
        </StrokeIcon>
    );
}

/** 最後の局面へ。 */
export function LastIcon({ className }: IconProps): ReactElement {
    return (
        <StrokeIcon className={className}>
            <path d="M18 5v14M5 5l9 7-9 7V5z" />
        </StrokeIcon>
    );
}
