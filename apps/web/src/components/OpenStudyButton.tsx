import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { useOpenStudy } from "../hooks/useOpenStudy";

interface OpenStudyButtonProps {
    /**
     * 研究ノートを開く（同じ棋譜のノートがあればそれを、無ければ作って）。開くノートの ID を返す。
     * `lib/studyEntry` の関数を渡す。
     */
    open: () => Promise<{ studyId: string }>;
    label?: string;
    /** 見た目。`primary` は主ボタン、`outline` は枠線の控えめなボタン。 */
    variant?: "primary" | "outline";
    /** `compact` は、スマホの盤の下の 1 行に収める小さいボタン。 */
    size?: "default" | "compact";
    className?: string;
}

const COMPACT_ERROR_MS = 6000;

/**
 * 「研究ノートで開く」。棋譜を見ている画面（rshogi viewer、自分の対局、`/play`）に置く共通の入口。
 * 押すと研究ノートを用意して、その画面へ移る。
 */
export function OpenStudyButton({
    open,
    label = "研究ノートで開く",
    variant = "primary",
    size = "default",
    className,
}: OpenStudyButtonProps): ReactElement {
    const { openStudy, isBusy, error } = useOpenStudy();

    const compact = size === "compact";
    // 小さいボタンのエラーは盤や移動のボタンに重なるので、しばらくしたら消す（押し直せばまた出る）。
    const [compactErrorHidden, setCompactErrorHidden] = useState(false);
    useEffect(() => {
        setCompactErrorHidden(false);
        if (!compact || !error) return;
        const timer = setTimeout(() => setCompactErrorHidden(true), COMPACT_ERROR_MS);
        return () => clearTimeout(timer);
    }, [compact, error]);
    return (
        // 小さいボタンは 1 行に並べて置くので、文言の差し替えやエラーで行の幅・高さを変えない
        // （エラーは行の外に重ねて出す）。
        <div className={cn("flex flex-col gap-1", compact && "relative")}>
            <button
                type="button"
                onClick={() => void openStudy(open)}
                disabled={isBusy}
                className={cn(
                    "rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                    size === "compact"
                        ? "whitespace-nowrap px-2 py-0.5 text-xs"
                        : "px-4 py-2 text-sm",
                    variant === "primary"
                        ? "bg-primary text-primary-foreground shadow hover:bg-primary/90"
                        : "border border-input bg-background text-foreground hover:bg-muted/50",
                    className,
                )}
            >
                {compact ? (
                    <span className="grid">
                        <span
                            className={cn("col-start-1 row-start-1", isBusy && "invisible")}
                            aria-hidden={isBusy}
                        >
                            {label}
                        </span>
                        <span
                            className={cn("col-start-1 row-start-1", !isBusy && "invisible")}
                            aria-hidden={!isBusy}
                        >
                            準備中…
                        </span>
                    </span>
                ) : isBusy ? (
                    "準備中…"
                ) : (
                    label
                )}
            </button>
            {error && !(compact && compactErrorHidden) && (
                <p
                    role="alert"
                    className={cn(
                        "text-xs text-destructive",
                        compact &&
                            "pointer-events-none absolute top-full right-0 z-30 mt-1 w-max max-w-64 rounded-md border border-border bg-card px-2 py-1 shadow-md",
                    )}
                >
                    {error}
                </p>
            )}
        </div>
    );
}
