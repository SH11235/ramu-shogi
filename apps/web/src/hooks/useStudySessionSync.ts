import { useEffect } from "react";
import { useAuthSession } from "./useAuthSession";

/**
 * ログイン状態を研究ノートの同期エンジンに伝える（アプリ全体で 1 か所）。
 *
 * セッションが確定したとき・変わったときに呼ぶ。ログイン中なら、未ログインのあいだに
 * このブラウザで作ったノートをそのアカウントに引き継ぎ、送信待ちを流す（設計書 7.2）。
 * どのページでログインしても引き継がれるよう、研究ノートのページではなくここに置く。
 *
 * 同期エンジン（と IndexedDB）は研究ノートを使わない人には要らないので、全ページの
 * 起動時の読み込みに載せず、セッションが確定してから読み込む。
 */
export function useStudySessionSync(): void {
    const { session, isLoadingSession } = useAuthSession();
    const sessionKnown = !isLoadingSession;
    const userId = session?.authenticated ? session.user.id : null;

    useEffect(() => {
        if (!sessionKnown) return;
        let cancelled = false;
        void import("../lib/studySync")
            .then(({ ensureStudySession }) => {
                if (cancelled) return undefined;
                return ensureStudySession(userId);
            })
            .catch((error: unknown) => {
                console.error("[study] 同期エンジンを準備できませんでした", error);
            });
        return () => {
            cancelled = true;
        };
    }, [sessionKnown, userId]);
}
