import type { ReactElement } from "react";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../tooltip";

/**
 * KIF 形式でクリップボードにコピーするボタン（アイコン）。コピーできたら 2 秒だけ ✓ にする。
 */
export function KifCopyButton({ getKif }: { getKif: () => string }): ReactElement {
    const [copySuccess, setCopySuccess] = useState(false);

    const handleCopy = async () => {
        const kifString = getKif();
        try {
            await navigator.clipboard.writeText(kifString);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (error) {
            console.error("Failed to copy to clipboard:", error);
        }
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    className={`w-7 h-7 flex items-center justify-center text-[14px] rounded border cursor-pointer transition-colors duration-150 ${
                        copySuccess
                            ? "bg-status-success text-status-success-fg border-status-success"
                            : "bg-background text-foreground border-border hover:bg-muted"
                    }`}
                    onClick={handleCopy}
                    aria-label="KIF形式でコピー"
                >
                    {copySuccess ? "✓" : "📋"}
                </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
                <div className="text-[11px]">{copySuccess ? "コピー完了!" : "KIF形式でコピー"}</div>
            </TooltipContent>
        </Tooltip>
    );
}
