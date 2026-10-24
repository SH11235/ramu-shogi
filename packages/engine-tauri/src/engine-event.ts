import type { EngineEvent } from "@shogi/engine-client";

/**
 * Desktop（Rust）の engine イベントは、届かなかった項目（`Option` の `None`）を null のまま JSON にする。
 * EngineEvent の項目は「無いときは undefined」の約束なので、受け取った所で null の項目を落とす
 * （残すと `scoreCp !== undefined` のような判定が null を値として扱う）。
 */
export function normalizeEngineEvent(payload: EngineEvent): EngineEvent {
    const entries = Object.entries(payload);
    if (!entries.some(([, value]) => value === null)) return payload;
    return Object.fromEntries(entries.filter(([, value]) => value !== null)) as EngineEvent;
}
