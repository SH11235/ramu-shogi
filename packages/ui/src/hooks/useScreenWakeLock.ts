import { useEffect } from "react";

/**
 * `active` の間、画面が消灯・ロックしないようにする（Screen Wake Lock API）。
 *
 * スマホは操作が無いと 30 秒ほどで画面を消し、ロックすると通信も止まる。対局中や観戦中に
 * 相手の手を待っている間も画面を点けておくために使う。
 * - 対応していないブラウザ、省電力モードなどで断られた場合は何もしない（消灯するだけ）。
 * - 別のタブやアプリへ移ると、ブラウザが自動で解除する。戻ってきたら取り直す。
 */
export function useScreenWakeLock(active: boolean): void {
    useEffect(() => {
        if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
        let sentinel: WakeLockSentinel | null = null;
        let requesting = false;
        // 取りに行っている間に画面へ戻ってきた。いまの取り込みが（隠れていたせいで）断られても、
        // 終わったあとにもう一度取りに行く。
        let retryWhenSettled = false;
        let disposed = false;
        const request = async (): Promise<void> => {
            if (disposed || document.visibilityState !== "visible") return;
            if (sentinel && !sentinel.released) return;
            if (requesting) {
                retryWhenSettled = true;
                return;
            }
            requesting = true;
            try {
                const next = await navigator.wakeLock.request("screen");
                if (disposed) {
                    void next.release().catch(() => {});
                    return;
                }
                sentinel = next;
                // 見えたまま解除されたとき（省電力モードになった、など）も取り直す。
                next.addEventListener("release", handleRelease);
            } catch {
                // 省電力モードなどで断られた。画面が消えるだけなので、そのまま続ける。
            } finally {
                requesting = false;
            }
            if (retryWhenSettled) {
                retryWhenSettled = false;
                await request();
            }
        };
        const handleVisibilityChange = (): void => {
            void request();
        };
        // request の中から参照するので、巻き上げられる function で書く。
        function handleRelease(): void {
            void request();
        }
        void request();
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            disposed = true;
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            if (sentinel) sentinel.removeEventListener("release", handleRelease);
            if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
            sentinel = null;
        };
    }, [active]);
}
