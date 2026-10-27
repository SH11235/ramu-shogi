import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import type { Message } from "../shogi-match/types";

/**
 * 通知。レイアウトを動かさないよう、固定した位置に重ねて出す。
 *
 * 画面の上（ページの見出しのすぐ下）に出す。下に出すと、スマートフォンでは局面の移動ボタンや
 * 下端に固定した操作に、PC ではコメント欄に重なるため。
 */
export function StudyNotice({
    message,
    onDismiss,
}: {
    message: Message | null;
    onDismiss: () => void;
}): ReactElement {
    return (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex justify-center px-3">
            {message && (
                <div
                    role={message.type === "error" ? "alert" : "status"}
                    className={cn(
                        "pointer-events-auto flex max-w-[min(36rem,100%)] items-start gap-3 whitespace-pre-line rounded-lg border px-3 py-2 text-sm shadow-panel",
                        message.type === "error"
                            ? "border-destructive/40 bg-card text-destructive"
                            : message.type === "warning"
                              ? "border-status-warning-border bg-card text-status-warning"
                              : "border-status-success-border bg-card text-status-success",
                    )}
                >
                    <p className="min-w-0 flex-1">{message.text}</p>
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="shrink-0 rounded-sm text-xs underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        閉じる
                    </button>
                </div>
            )}
        </div>
    );
}
