import type { ReactElement } from "react";
import { ConnectionLostNotice } from "../connection-lost-notice";
import type { GameConnection } from "./useOnlineGameRoom";

interface ConnectionNoticesProps {
    offlineSeats: ReadonlySet<string>;
    connection: GameConnection;
    /** 終局した後は、自分の接続の案内を出さない */
    isGameOver: boolean;
    onExit?: () => void;
}

/** 接続の通知: 盤面の上に重ね、出し入れで盤面が動かないようにする */
export function ConnectionNotices({
    offlineSeats,
    connection,
    isGameOver,
    onExit,
}: ConnectionNoticesProps): ReactElement {
    return (
        <div className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 z-notice flex w-[min(90vw,420px)] flex-col items-center gap-2">
            {offlineSeats.size > 0 && (
                <div className="rounded-lg bg-destructive px-4 py-2 text-sm text-destructive-foreground shadow-lg">
                    {Array.from(offlineSeats).map((s) => (
                        <span key={s}>{s === "b" ? "先手" : "後手"}が切断しました</span>
                    ))}
                </div>
            )}
            {!isGameOver && connection.state === "reconnecting" && (
                <output className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-lg">
                    再接続中...
                </output>
            )}
            {!isGameOver && connection.state === "lost" && (
                <ConnectionLostNotice
                    reason={connection.canResume ? "seat" : "reload"}
                    className="pointer-events-auto w-full shadow-lg"
                />
            )}
            {!isGameOver &&
                connection.state === "rejected" &&
                (connection.finished && onExit ? (
                    <ConnectionLostNotice
                        reason="finished"
                        onExit={onExit}
                        className="pointer-events-auto w-full shadow-lg"
                    />
                ) : (
                    // 戻り先を渡されていなければ、終局していても再読み込みで画面を出し直してもらう
                    <ConnectionLostNotice
                        reason={connection.finished ? "reload" : "session"}
                        className="pointer-events-auto w-full shadow-lg"
                    />
                ))}
        </div>
    );
}
