const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileRenderOptions {
    sitekey: string;
    action?: string;
    appearance?: "always" | "execute" | "interaction-only";
    callback?: (token: string) => void;
    "error-callback"?: (code: string) => boolean;
    "timeout-callback"?: () => void;
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

export function loadTurnstile(): Promise<TurnstileApi> {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = SCRIPT_URL;
        script.async = true;
        script.onload = () => {
            if (window.turnstile) resolve(window.turnstile);
            else reject(new Error("turnstile unavailable"));
        };
        script.onerror = () => reject(new Error("turnstile script failed to load"));
        document.head.appendChild(script);
    }).catch((error: unknown) => {
        // 読み込みに失敗した script を残すと、次の送信でも同じ失敗を返し続ける
        scriptPromise = null;
        throw error;
    });
    return scriptPromise;
}

/**
 * ウィジェットを描画してトークンを 1 つ取り、取り終えたら外す。トークンは 1 回しか使えず
 * 5 分で切れるので、送信のたびに取り直す。取れなかったときは undefined を返し、
 * 通すかどうかはサーバーに任せる。
 */
export function requestTurnstileToken(
    api: TurnstileApi,
    container: HTMLElement,
    sitekey: string,
): Promise<string | undefined> {
    return new Promise((resolve) => {
        let widgetId: string | undefined;
        let settled = false;
        const finish = (token: string | undefined) => {
            if (settled) return;
            settled = true;
            resolve(token);
            // 呼び出し元の callback が戻ってから外す
            setTimeout(() => {
                if (widgetId !== undefined) api.remove(widgetId);
            }, 0);
        };
        try {
            widgetId = api.render(container, {
                sitekey,
                action: "create-room",
                appearance: "interaction-only",
                callback: (token) => finish(token),
                "error-callback": () => {
                    finish(undefined);
                    return true;
                },
                "timeout-callback": () => finish(undefined),
            });
        } catch {
            finish(undefined);
        }
    });
}
