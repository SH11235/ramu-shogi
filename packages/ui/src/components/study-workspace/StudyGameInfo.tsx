/**
 * 研究ノートの対局情報（棋戦・日時・結果・持ち時間・エンジンの条件など、meta の項目）。
 * 項目が無ければ何も出さない。長い値（USI オプションの一覧など）があるので、畳んで置く。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { studyMetaEntries } from "./studyView";

interface StudyGameInfoProps {
    meta: Record<string, string>;
    className?: string;
}

export function StudyGameInfo({ meta, className }: StudyGameInfoProps): ReactElement | null {
    const entries = studyMetaEntries(meta);
    if (entries.length === 0) return null;
    return (
        <details className={cn("min-w-0", className)}>
            <summary className="cursor-pointer select-none hover:text-foreground">対局情報</summary>
            <dl className="mt-1 grid max-h-64 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 overflow-y-auto rounded-md border border-border bg-background p-2 text-foreground">
                {entries.map((entry) => (
                    <div key={entry.key} className="contents">
                        <dt className="whitespace-nowrap text-muted-foreground">{entry.label}</dt>
                        <dd className="break-all">{entry.value}</dd>
                    </div>
                ))}
            </dl>
        </details>
    );
}
