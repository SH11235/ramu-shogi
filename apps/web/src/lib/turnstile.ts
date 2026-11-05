const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_TIMEOUT_MS = 10_000;
// 利用者の操作が要らない判定はふつう数秒で終わる。操作を求められたら Turnstile 自身の
// timeout-callback に任せ、この期限は止める
const NON_INTERACTIVE_DEADLINE_MS = 15_000;

interface TurnstileRenderOptions {
    sitekey: string;
    action?: string;
    appearance?: "always" | "execute" | "interaction-only";
    callback?: (token: string) => void;
    "error-callback"?: (code: string) => void;
    "timeout-callback"?: () => void;
    "unsupported-callback"?: () => void;
    "before-interactive-callback"?: () => void;
}

export interface TurnstileApi {
    render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
    remove(widgetId: string): void;
}

declare global {
    interface Window {
        turnstile?: TurnstileApi;
    }
}

export function turnstileSiteKey(): string | undefined {
    const raw = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    return raw?.trim() || undefined;
}

let scriptPromise: Promise<TurnstileApi> | null = null;

export function loadTurnstile(timeoutMs = SCRIPT_TIMEOUT_MS): Promise<TurnstileApi> {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (scriptPromise) return scriptPromise;
    const script = document.createElement("script");
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("turnstile script timed out")), timeoutMs);
        script.src = SCRIPT_URL;
        script.async = true;
        script.onload = () => {
            clearTimeout(timer);
            if (window.turnstile) resolve(window.turnstile);
            else reject(new Error("turnstile unavailable"));
        };
        script.onerror = () => {
            clearTimeout(timer);
            reject(new Error("turnstile script failed to load"));
        };
        document.head.appendChild(script);
    }).catch((error: unknown) => {
        // 失敗した script と promise を残すと、次の送信でも同じ失敗を返し続ける
        script.remove();
        scriptPromise = null;
        throw error;
    });
    return scriptPromise;
}

/**
 * ウィジェットを描画してトークンを 1 つ取り、取り終えたら外す。トークンは 1 回しか使えず
 * 5 分で切れるので、送信のたびに取り直す。取れなかったとき、期限を過ぎたとき、
 * signal が中断されたときは undefined を返し、通すかどうかはサーバーに任せる。
 */
export function requestTurnstileToken(
    api: TurnstileApi,
    container: HTMLElement,
    sitekey: string,
    signal?: AbortSignal,
): Promise<string | undefined> {
    if (signal?.aborted) return Promise.resolve(undefined);
    return new Promise((resolve) => {
        let widgetId: string | undefined;
        let settled = false;
        const deadline = setTimeout(() => finish(undefined), NON_INTERACTIVE_DEADLINE_MS);
        const onAbort = () => finish(undefined);
        function finish(token: string | undefined): void {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            signal?.removeEventListener("abort", onAbort);
            resolve(token);
            // 呼び出し元の callback が戻ってから外す
            setTimeout(() => {
                if (widgetId !== undefined) api.remove(widgetId);
            }, 0);
        }
        signal?.addEventListener("abort", onAbort);
        try {
            widgetId = api.render(container, {
                sitekey,
                action: "create-room",
                appearance: "interaction-only",
                callback: (token) => finish(token),
                "error-callback": () => finish(undefined),
                "timeout-callback": () => finish(undefined),
                "unsupported-callback": () => finish(undefined),
                "before-interactive-callback": () => clearTimeout(deadline),
            });
        } catch {
            finish(undefined);
        }
    });
}
