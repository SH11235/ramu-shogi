import {
    USAGE_EVENTS_PATH,
    USAGE_ROUTES,
    USAGE_SCHEMA_VERSION,
    type UsageEventName,
    type UsageEventProps,
} from "../../worker/usage-events";

const PRODUCTION_HOST = "ramu-shogi.sh11235.com";
const DEVICE_ID_KEY = "ramu.usage.deviceId";
const OPT_OUT_KEY = "ramu.usage.optOut";
const INTERNAL_KEY = "ramu.usage.internal";

type UsageDeps = {
    hostname: string;
    search: string;
    referrer: string;
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    globalPrivacyControl: boolean;
    randomUUID: () => string;
    send: (path: string, body: string) => void;
};

/** 送らない理由。画面の説明に使う */
type UsageStatus = "enabled" | "opted_out" | "gpc" | "unsupported";

function readStorage(deps: UsageDeps, key: string): string | null {
    try {
        return deps.storage?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

function writeStorage(deps: UsageDeps, key: string, value: string | null): void {
    try {
        if (value === null) deps.storage?.removeItem(key);
        else deps.storage?.setItem(key, value);
    } catch {
        // 保存できない環境（プライベートブラウズの一部など）では、端末 ID を持てないので送らない
    }
}

function externalReferrerHost(referrer: string, hostname: string): string | undefined {
    try {
        const host = new URL(referrer).hostname.toLowerCase();
        return host && host !== hostname ? host : undefined;
    } catch {
        return undefined;
    }
}

export function createUsageClient(deps: UsageDeps) {
    let loggedIn = false;
    let lastHref: string | null = null;
    let referrer = externalReferrerHost(deps.referrer, deps.hostname);

    // 運営者の端末は `?internal=1` で印を付け、集計で除く。送らない形にしないのは、本番で送信を確かめるため
    const internalParam = new URLSearchParams(deps.search).get("internal");
    if (internalParam === "1") writeStorage(deps, INTERNAL_KEY, "1");
    if (internalParam === "0") writeStorage(deps, INTERNAL_KEY, null);

    function status(): UsageStatus {
        if (deps.hostname !== PRODUCTION_HOST || !deps.storage) return "unsupported";
        if (deps.globalPrivacyControl) return "gpc";
        if (readStorage(deps, OPT_OUT_KEY) === "1") return "opted_out";
        return "enabled";
    }

    function deviceId(): string | null {
        if (status() === "unsupported") return null;
        const stored = readStorage(deps, DEVICE_ID_KEY);
        if (stored) return stored;
        const created = deps.randomUUID();
        writeStorage(deps, DEVICE_ID_KEY, created);
        return readStorage(deps, DEVICE_ID_KEY);
    }

    function track<E extends UsageEventName>(event: E, props?: UsageEventProps<E>): void {
        if (status() !== "enabled") return;
        const id = deviceId();
        if (!id) return;
        const payload = {
            v: USAGE_SCHEMA_VERSION,
            deviceId: id,
            event,
            ...(readStorage(deps, INTERNAL_KEY) === "1" ? { internal: true } : {}),
            ...(loggedIn ? { loggedIn: true } : {}),
            ...(props ? { props } : {}),
        };
        try {
            deps.send(USAGE_EVENTS_PATH, JSON.stringify(payload));
        } catch {
            // 計測の失敗で画面の操作を止めない
        }
    }

    return {
        status,
        /** お問い合わせ用に画面へ出す端末 ID。送らない環境では null */
        deviceId,
        setOptOut(optOut: boolean): void {
            writeStorage(deps, OPT_OUT_KEY, optOut ? "1" : null);
        },
        setLoggedIn(value: boolean): void {
            loggedIn = value;
        },
        track,
        /**
         * 表示した URL が変わったときだけ page_view を送る（同じ URL の通知が重なっても 1 回）。
         * 送るのはルートの型だけで、URL は重複の判定にしか使わない。参照元は最初の 1 回だけ付ける
         */
        trackPageView(route: string, href: string): void {
            if (href === lastHref || !USAGE_ROUTES.includes(route)) return;
            lastHref = href;
            track("page_view", referrer ? { route, referrer } : { route });
            referrer = undefined;
        },
    };
}

export type UsageClient = ReturnType<typeof createUsageClient>;

function browserDeps(): UsageDeps {
    let storage: Storage | null = null;
    try {
        storage = window.localStorage;
    } catch {
        storage = null;
    }
    return {
        hostname: window.location.hostname,
        search: window.location.search,
        referrer: document.referrer,
        storage,
        globalPrivacyControl:
            (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl ===
            true,
        randomUUID: () => crypto.randomUUID(),
        send: (path, body) => {
            // ページを閉じる間際でも届くよう sendBeacon を使う。使えないときは keepalive の fetch
            if (navigator.sendBeacon?.(path, body)) return;
            void fetch(path, { method: "POST", body, keepalive: true }).catch(() => {});
        },
    };
}

export const usageClient: UsageClient = createUsageClient(browserDeps());
