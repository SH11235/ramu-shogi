import type { ReactElement } from "react";
import { useState } from "react";

interface FreeNnueResource {
    /** 評価関数名 */
    name: string;
    /** アーキテクチャ */
    architecture: string;
    /** FV_SCALE 値 */
    fvScale: number;
    /** ダウンロードURL */
    downloadUrl: string;
    /** 開発者名 */
    author: string;
    /** 開発者URL（Twitter/GitHub等） */
    authorUrl: string;
}

const FREE_NNUE_RESOURCES: FreeNnueResource[] = [
    {
        name: "AobaNNUE",
        architecture: "halfkp_768x2-16-64",
        fvScale: 40,
        downloadUrl: "https://github.com/yssaya/AobaNNUE/releases/tag/v1.1",
        author: "yssaya",
        authorUrl: "https://github.com/yssaya",
    },
];

/**
 * 無料で手に入る将棋AI情報を表示するコンポーネント
 * 折りたたみ可能なアコーディオン形式
 */
export function NnueFreeResourcesInfo(): ReactElement {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="rounded-md bg-muted text-xs">
            {/* ヘッダー（折りたたみトグル） */}
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent px-3 py-3 text-[13px] font-semibold text-foreground hover:bg-muted/50"
                aria-expanded={isExpanded}
            >
                <div className="flex items-center gap-2">
                    <span className="text-base">📚</span>
                    <span>無料で手に入る将棋AI</span>
                </div>
                <span
                    className={`text-sm transition-transform ${
                        isExpanded ? "rotate-180" : "rotate-0"
                    }`}
                >
                    ▼
                </span>
            </button>

            {/* コンテンツ（展開時のみ表示） */}
            {isExpanded && (
                <div className="flex flex-col gap-2 px-3 pb-3">
                    <p className="mb-1 text-xs text-muted-foreground">
                        コンピュータ将棋界で公開されている強力な評価関数です
                    </p>
                    {FREE_NNUE_RESOURCES.map((resource) => (
                        <div
                            key={resource.name}
                            className="rounded-md border border-border bg-background p-2.5"
                        >
                            {/* 評価関数名 */}
                            <div className="mb-1.5 text-[13px] font-semibold text-foreground">
                                {resource.name}
                            </div>

                            {/* アーキテクチャとFV_SCALE */}
                            <div className="mb-2 flex gap-3 text-[11px] text-muted-foreground">
                                <span>{resource.architecture}</span>
                                <span>•</span>
                                <span>FV_SCALE: {resource.fvScale}</span>
                            </div>

                            {/* リンク */}
                            <div className="flex gap-3 text-xs">
                                <a
                                    href={resource.downloadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary no-underline hover:underline"
                                >
                                    <DownloadIcon />
                                    ダウンロードページ
                                </a>
                                <a
                                    href={resource.authorUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary no-underline hover:underline"
                                >
                                    <UserIcon />
                                    {resource.author}
                                </a>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function DownloadIcon(): ReactElement {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    );
}

function UserIcon(): ReactElement {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </svg>
    );
}
