import {
    USAGE_EVENTS_PATH,
    USAGE_ROUTES,
    USAGE_SCHEMA_VERSION,
    type UsageEventName,
    type UsageEventProps,
} from "../../worker/usage-events";

const PRODUCTION_HOST = "ramu-shogi.sh11235.com";
const DEVICE_ID_KEY = "ramu.usage.deviceId";
const INTERNAL_KEY = "ramu.usage.internal";

type UsageDeps = {
    hostname: string;
    search: string;
    referrer: string;
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    randomUUID: () => string;
    send: (path: string, body: string) => void;
};

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

// 手元の開発機や LAN 内の機械のアドレスは、送っても集計の役に立たない
const LOCAL_HOST =
    /^(localhost|.*\.local|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[.*\])$/;

function externalReferrerHost(referrer: string, hostname: string): string | undefined {
    try {
        const host = new URL(referrer).hostname.toLowerCase();
        return host && host !== hostname && !LOCAL_HOST.test(host) ? host : undefined;
    } catch {
        return undefined;
    }
}

export function createUsageClient(deps: UsageDeps) {
    let loggedIn = false;
    let lastPathname: string | null = null;
    let referrer = externalReferrerHost(deps.referrer, deps.hostname);

    // 運営者の端末は `?internal=1` で印を付け、集計で除く。送らない形にしないのは、本番で送信を確かめるため
    const internalParam = new URLSearchParams(deps.search).get("internal");
    if (internalParam === "1") writeStorage(deps, INTERNAL_KEY, "1");
    if (internalParam === "0") writeStorage(deps, INTERNAL_KEY, null);

    const enabled = deps.hostname === PRODUCTION_HOST && deps.storage !== null;

    function deviceId(): string | null {
        const stored = readStorage(deps, DEVICE_ID_KEY);
        if (stored) return stored;
        const created = deps.randomUUID();
        writeStorage(deps, DEVICE_ID_KEY, created);
        return readStorage(deps, DEVICE_ID_KEY);
    }

    function track<E extends UsageEventName>(event: E, props?: UsageEventProps<E>): void {
        if (!enabled) return;
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
        setLoggedIn(value: boolean): void {
            loggedIn = value;
        },
        track,
        /**
         * 表示したパスが変わったときだけ page_view を送る（同じパスの通知が重なっても、絞り込みなどで
         * クエリだけが変わっても 1 回）。送るのはルートの型だけで、パスは重複の判定にしか使わない。
         * 参照元は最初の 1 回だけ付ける
         */
        trackPageView(route: string, pathname: string): void {
            if (pathname === lastPathname || !USAGE_ROUTES.includes(route)) return;
            lastPathname = pathname;
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
        randomUUID: () => crypto.randomUUID(),
        send: (path, body) => {
            // sendBeacon は Referer（ID 入りのページの URL）と Cookie を外せないので、fetch で両方を外して送る。
            // keepalive はページを閉じる間際の送信を届けるため。mode は既定の cors のままにする（same-origin に
            // すると no-referrer で Origin が null になり、Worker が別オリジンとして捨てる）
            void fetch(path, {
                method: "POST",
                body,
                keepalive: true,
                credentials: "omit",
                referrerPolicy: "no-referrer",
            }).catch(() => {});
        },
    };
}

export const usageClient: UsageClient = createUsageClient(browserDeps());
