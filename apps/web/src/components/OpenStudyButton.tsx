import { cn } from "@shogi/design-system";
import { useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { useAuthSession } from "../hooks/useAuthSession";
import { ensureStudySession } from "../lib/studySync";

interface OpenStudyButtonProps {
    /**
     * 研究ノートを開く（同じ棋譜のノートがあればそれを、無ければ作って）。開くノートの ID を返す。
     * `lib/studyEntry` の関数を渡す。
     */
    open: () => Promise<{ studyId: string }>;
    label?: string;
    /** 見た目。`primary` は主ボタン、`outline` は枠線の控えめなボタン。 */
    variant?: "primary" | "outline";
    className?: string;
}

/**
 * 「研究ノートで開く」。棋譜を見ている画面（rshogi viewer、自分の対局、`/play`）に置く共通の入口。
 * 押すと研究ノートを用意して、その画面へ移る。
 */
export function OpenStudyButton({
    open,
    label = "研究ノートで開く",
    variant = "primary",
    className,
}: OpenStudyButtonProps): ReactElement {
    const navigate = useNavigate();
    const { session, isLoadingSession } = useAuthSession();
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleClick = async (): Promise<void> => {
        if (isBusy) return;
        setIsBusy(true);
        setError(null);
        try {
            // ログイン中なら、クラウドにある同じ棋譜のノートも探せるよう、先にログイン状態を伝える。
            if (!isLoadingSession && session !== null) {
                await ensureStudySession(session?.authenticated ? session.user.id : null);
            }
            const { studyId } = await open();
            await navigate({ to: "/studies/$studyId", params: { studyId } });
        } catch (failure) {
            setError(
                `研究ノートを開けませんでした: ${
                    failure instanceof Error ? failure.message : String(failure)
                }`,
            );
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-1">
            <button
                type="button"
                onClick={() => void handleClick()}
                disabled={isBusy}
                className={cn(
                    "rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                    variant === "primary"
                        ? "bg-primary text-primary-foreground shadow hover:bg-primary/90"
                        : "border border-input bg-background text-foreground hover:bg-muted/50",
                    className,
                )}
            >
                {isBusy ? "準備中…" : label}
            </button>
            {error && (
                <p role="alert" className="text-xs text-destructive">
                    {error}
                </p>
            )}
        </div>
    );
}
