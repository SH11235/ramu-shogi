import { describe, expect, it, vi } from "vitest";
import { buildLegalCacheKey, LegalMoveCache } from "./legalMoveCache";

const deferred = <T>() => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

describe("buildLegalCacheKey", () => {
    it("開始局面・指し手列・パス権のどれかが違えば別のキーになる", () => {
        const base = buildLegalCacheKey("sfen-a", ["7g7f"], {});
        expect(buildLegalCacheKey("sfen-a", ["7g7f"], {})).toBe(base);
        expect(buildLegalCacheKey("sfen-b", ["7g7f"], {})).not.toBe(base);
        expect(buildLegalCacheKey("sfen-a", ["2g2f"], {})).not.toBe(base);
        expect(
            buildLegalCacheKey("sfen-a", ["7g7f"], { passRights: { sente: 1, gote: 1 } }),
        ).not.toBe(base);
        expect(
            buildLegalCacheKey("sfen-a", ["7g7f"], { passRights: { sente: 1, gote: 0 } }),
        ).not.toBe(buildLegalCacheKey("sfen-a", ["7g7f"], { passRights: { sente: 0, gote: 1 } }));
    });
});

describe("LegalMoveCache", () => {
    it("同じキーの 2 回目は resolver を呼ばない", async () => {
        const cache = new LegalMoveCache();
        const resolver = vi.fn(async () => ["7g7f"]);
        const key = buildLegalCacheKey("sfen-a", [], {});

        await cache.getOrResolve(key, resolver);
        const second = await cache.getOrResolve(key, resolver);

        expect(resolver).toHaveBeenCalledTimes(1);
        expect([...second]).toEqual(["7g7f"]);
    });

    it("取得中に clear されたら、その応答はキャッシュに保存しない", async () => {
        const cache = new LegalMoveCache();
        // 開始局面を読み込み直しても、指し手列もパス権も同じ（＝同じキーになる）場合。
        const key = buildLegalCacheKey("sfen-a", [], {});
        const staleResponse = deferred<string[]>();

        const pending = cache.getOrResolve(key, () => staleResponse.promise);
        // 応答が届く前に局面を入れ替える。
        cache.clear();
        staleResponse.resolve(["7g7f"]);
        // 取りに行った本人には結果を返すが、キャッシュには残さない。
        expect([...(await pending)]).toEqual(["7g7f"]);
        expect(cache.isCached(key)).toBe(false);
        expect(cache.getCached()).toBeNull();

        const resolver = vi.fn(async () => ["2h2e"]);
        expect([...(await cache.getOrResolve(key, resolver))]).toEqual(["2h2e"]);
        expect(resolver).toHaveBeenCalledTimes(1);
    });

    it("指し手列が同じでも、開始局面が違えば前の局面の合法手を返さない", async () => {
        const cache = new LegalMoveCache();
        await cache.getOrResolve(buildLegalCacheKey("sfen-a", [], {}), async () => ["7g7f"]);

        const legalOfB = await cache.getOrResolve(
            buildLegalCacheKey("sfen-b", [], {}),
            async () => ["2h2e"],
        );

        expect([...legalOfB]).toEqual(["2h2e"]);
    });

    it("clear の後に始めた取得は保存する", async () => {
        const cache = new LegalMoveCache();
        const key = buildLegalCacheKey("sfen-a", [], {});
        cache.clear();
        await cache.getOrResolve(key, async () => ["7g7f"]);
        expect(cache.isCached(key)).toBe(true);
    });
});
