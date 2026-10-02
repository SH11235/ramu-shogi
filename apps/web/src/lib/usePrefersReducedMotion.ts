import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
    const mql = window.matchMedia(QUERY);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
}

const getSnapshot = (): boolean => window.matchMedia(QUERY).matches;

// SSR は無い SPA だが、テスト環境などで matchMedia が無い場合は動きを許可する
const getServerSnapshot = (): boolean => false;

/** OS の「視差効果を減らす」設定。表示中に切り替わっても追従する。 */
export function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
