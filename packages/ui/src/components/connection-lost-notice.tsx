import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";

/**
 * seat: 再読み込みすると保存済みのトークンで対局者の席へ戻れる
 * reload: 席へは戻れないが、再読み込みすれば見直せる
 * session: サーバーが席への復帰を拒んだ
 * finished: 切断している間に終局した。終局した部屋へは参加し直せないので、再読み込みでなく
 * 対局画面の終局後と同じくトップへ戻る導線を出す
 */
type ConnectionLostNoticeProps = { className?: string } & (
    | { reason: "seat" | "reload" | "session"; onExit?: never }
    | { reason: "finished"; onExit: () => void }
);

const MESSAGES: Record<ConnectionLostNoticeProps["reason"], string> = {
    seat: "接続が切れました。再読み込みすると元の席に戻れます",
    reload: "接続が切れました。再読み込みしてください",
    session: "セッションが切れました。再読み込みして、再度参加してください",
    finished: "接続が切れている間に、この対局は終了しました",
};

const BUTTON_CLASS =
    "rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground shadow-sm hover:bg-secondary/80 transition-colors";

export function ConnectionLostNotice(props: ConnectionLostNoticeProps): ReactElement {
    return (
        <div
            role="alert"
            className={cn(
                "flex flex-col gap-3 rounded-lg border border-border bg-card p-4",
                props.className,
            )}
        >
            <p className="text-sm text-foreground">{MESSAGES[props.reason]}</p>
            {props.reason === "finished" ? (
                <button type="button" onClick={props.onExit} className={BUTTON_CLASS}>
                    トップへ戻る
                </button>
            ) : (
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className={BUTTON_CLASS}
                >
                    再読み込み
                </button>
            )}
        </div>
    );
}
