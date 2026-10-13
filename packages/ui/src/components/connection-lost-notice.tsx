import type { ReactElement } from "react";

/**
 * seat: 再読み込みすると保存済みのトークンで対局者の席へ戻れる
 * reload: 席へは戻れないが、再読み込みすれば見直せる
 * session: サーバーが席への復帰を拒んだ
 */
type ConnectionLostReason = "seat" | "reload" | "session";

const MESSAGES: Record<ConnectionLostReason, string> = {
    seat: "接続が切れました。再読み込みすると元の席に戻れます",
    reload: "接続が切れました。再読み込みしてください",
    session: "セッションが切れました。再読み込みして、再度参加してください",
};

export function ConnectionLostNotice({ reason }: { reason: ConnectionLostReason }): ReactElement {
    return (
        <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
        >
            <p className="text-sm text-foreground">{MESSAGES[reason]}</p>
            <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground shadow-sm hover:bg-secondary/80 transition-colors"
            >
                再読み込み
            </button>
        </div>
    );
}
