import { getNnueErrorMessage, NnueError } from "@shogi/app-core";
import type { ReactElement } from "react";
import { Button } from "../button";

interface NnueErrorAlertProps {
    /** エラー */
    error: NnueError | Error | null;
    /** 閉じるボタン押下時のコールバック */
    onClose?: () => void;
}

/**
 * NNUE エラー表示アラート
 */
export function NnueErrorAlert({ error, onClose }: NnueErrorAlertProps): ReactElement | null {
    if (!error) return null;

    const message = error instanceof NnueError ? getNnueErrorMessage(error) : error.message;

    return (
        <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive"
        >
            {/* Error icon */}
            <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                className="mt-0.5 shrink-0"
                aria-hidden="true"
            >
                <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M10 6v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="10" cy="14" r="1" fill="currentColor" />
            </svg>

            {/* Message */}
            <div className="flex-1 text-sm">{message}</div>

            {/* Close button */}
            {onClose && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                    className="min-w-0 shrink-0 p-1 text-inherit"
                    aria-label="エラーを閉じる"
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path
                            d="M4 4l8 8M12 4l-8 8"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                        />
                    </svg>
                </Button>
            )}
        </div>
    );
}
