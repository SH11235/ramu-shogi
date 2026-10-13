import type { ReactElement } from "react";

/**
 * seat: 再読み込みすると保存済みのトークンで対局者の席へ戻れる
 * reload: 席へは戻れないが、再読み込みすれば見直せる
 * session: サーバーが席への復帰を拒んだ
 * finished: 切断している間に終局した。終局した部屋へは参加し直せないので、再読み込みでなく
 * 対局画面の終局後と同じくトップへ戻る導線を出す
 */
type ConnectionLostReason = "seat" | "reload" | "session" | "finished";

const MESSAGES: Record<ConnectionLostReason, string> = {
    seat: "接続が切れました。再読み込みすると元の席に戻れます",
    reload: "接続が切れました。再読み込みしてください",
    session: "セッションが切れました。再読み込みして、再度参加してください",
    finished: "接続が切れている間に、この対局は終了しました",
};

export function ConnectionLostNotice({
    reason,
    onExit,
}: {
    reason: ConnectionLostReason;
    onExit?: () => void;
}): ReactElement {
    return (
        <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
        >
            <p className="text-sm text-foreground">{MESSAGES[reason]}</p>
            {reason === "finished" && onExit && (
                <button
                    type="button"
                    onClick={onExit}
                    className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground shadow-sm hover:bg-secondary/80 transition-colors"
                >
                    トップへ戻る
                </button>
            )}
            {reason !== "finished" && (
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground shadow-sm hover:bg-secondary/80 transition-colors"
                >
                    再読み込み
                </button>
            )}
        </div>
    );
}
