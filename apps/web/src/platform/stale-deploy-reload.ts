/**
 * デプロイで content-hash 付きアセット (wasm / dynamic import chunk) が差し替わると、
 * 旧 index.html / 旧バンドルを掴んだままのクライアントは消えた旧 hash を要求して 404 になる。
 * worker (apps/web/worker/index.ts) は欠損 /assets/* を SPA fallback させず 404 にするため、
 * wasm streaming compile は "HTTP status code is not ok" で失敗する。
 *
 * stale 署名のときだけ新しい index.html を取りに full reload して回復する。
 * 真に壊れたデプロイ (全員が同じ 404) では reload ループになり得るので、
 * クールダウン内の再失敗では reload せず通常のエラー表示へ委ねる。
 */

const RELOAD_GUARD_KEY = "ramu-shogi:stale-asset-reloaded-at";
// reload 直後に再び失敗する場合は新 hash でも直っていない (= stale ではなく恒久障害) とみなし、
// この窓内では再 reload しない。
const RELOAD_COOLDOWN_MS = 60_000;

const STALE_ERROR_SIGNATURES = [
    // wasm streaming compile が 404 Response を受けたときの V8 メッセージ
    "http status code is not ok",
    // Vite dynamic import chunk が消えたときの表現 (Chromium / Firefox / Safari)
    "failed to fetch dynamically imported module",
    "error loading dynamically imported module",
    "importing a module script failed",
];

const toMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
        return String((error as { message: unknown }).message);
    }
    return String(error);
};

export const isStaleAssetError = (error: unknown): boolean => {
    const message = toMessage(error).toLowerCase();
    return STALE_ERROR_SIGNATURES.some((signature) => message.includes(signature));
};

const canReloadNow = (): boolean => {
    if (typeof window === "undefined") return false;
    try {
        const raw = window.sessionStorage.getItem(RELOAD_GUARD_KEY);
        const last = raw ? Number.parseInt(raw, 10) : 0;
        return !Number.isFinite(last) || Date.now() - last > RELOAD_COOLDOWN_MS;
    } catch {
        // sessionStorage 不可 (private mode 等) ではループ防止のガードが効かないため reload しない
        return false;
    }
};

// reload 前にガード時刻を永続化する。書けたら true。
// 書けない環境ではループ防止が成立しないため、呼び出し側は reload を見送る。
const markReloaded = (): boolean => {
    try {
        window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
        return true;
    } catch {
        return false;
    }
};

/** ガード付き full reload。実際に reload を開始したら true。 */
export const reloadForStaleDeploy = (): boolean => {
    // ガードを読めない / 書けない環境では loop 防止が効かないため reload しない
    if (!canReloadNow()) return false;
    if (!markReloaded()) return false;
    window.location.reload();
    return true;
};

/** error が stale 署名のときだけガード付き reload する。reload を開始したら true。 */
export const reloadOnStaleAsset = (error: unknown): boolean => {
    if (!isStaleAssetError(error)) return false;
    return reloadForStaleDeploy();
};

/**
 * dynamic import / 未捕捉の stale エラーに対する保険ハンドラを window へ登録する。
 * 個別 catch で拾えない経路 (route chunk の preload 失敗など) を回復させる。main.tsx から1回だけ呼ぶ。
 */
export const installStaleDeployReloadHandlers = (): void => {
    if (typeof window === "undefined") return;

    // Vite が dispatch する chunk preload 失敗イベント。発火時点で stale 確定なので署名チェック不要。
    window.addEventListener("vite:preloadError", (event) => {
        if (reloadForStaleDeploy()) event.preventDefault();
    });

    window.addEventListener("unhandledrejection", (event) => {
        if (reloadOnStaleAsset(event.reason)) event.preventDefault();
    });

    window.addEventListener("error", (event) => {
        if (reloadOnStaleAsset(event.error ?? event.message)) event.preventDefault();
    });
};
