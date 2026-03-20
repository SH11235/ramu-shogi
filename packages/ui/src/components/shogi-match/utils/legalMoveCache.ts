/**
 * 合法手のキャッシュを管理するクラス
 *
 * 指し手列（movesKey）をキーとして合法手のセットをキャッシュし、
 * 同じ局面での重複計算を避けます。
 *
 * movesKey = moves.join(" ") により、同じ手数でも分岐が異なれば
 * 別エントリとして扱われます。
 */
export class LegalMoveCache {
    private cache: { movesKey: string; moves: Set<string> } | null = null;

    /**
     * 指定された指し手列のキャッシュが存在するかチェックする
     *
     * @param movesKey - チェック対象の指し手列（moves.join(" ")）
     * @returns キャッシュが存在する場合は true
     */
    isCached(movesKey: string): boolean {
        return this.cache !== null && this.cache.movesKey === movesKey;
    }

    /**
     * キャッシュされた合法手のセットを取得する
     *
     * @returns キャッシュが存在する場合は合法手のセット、存在しない場合は null
     */
    getCached(): Set<string> | null {
        return this.cache?.moves ?? null;
    }

    /**
     * 合法手のセットをキャッシュに保存する
     *
     * @param movesKey - 指し手列（moves.join(" ")）
     * @param moves - 合法手のセット
     */
    set(movesKey: string, moves: Set<string>): void {
        this.cache = { movesKey, moves };
    }

    /**
     * キャッシュをクリアする
     */
    clear(): void {
        this.cache = null;
    }

    /**
     * 指定された指し手列の合法手を取得する（キャッシュ優先）
     *
     * @param movesKey - 現在の指し手列（moves.join(" ")）
     * @param resolver - 合法手を解決する非同期関数
     * @returns 合法手のセット
     *
     * @example
     * ```typescript
     * const cache = new LegalMoveCache();
     * const moves = ["7g7f", "3c3d"];
     * const movesKey = moves.join(" ");
     * const resolver = async () => {
     *   // 合法手を計算...
     *   return ["2g2f", "8h7g"];
     * };
     *
     * const result = await cache.getOrResolve(movesKey, resolver);
     * // 初回は resolver が呼ばれる
     *
     * const cached = await cache.getOrResolve(movesKey, resolver);
     * // 2回目はキャッシュが返される（resolver は呼ばれない）
     * ```
     */
    async getOrResolve(movesKey: string, resolver: () => Promise<string[]>): Promise<Set<string>> {
        if (this.isCached(movesKey)) {
            const cached = this.getCached();
            if (!cached) {
                throw new Error("Cache should exist when isCached returns true");
            }
            return cached;
        }

        const list = await resolver();
        const set = new Set(list);
        this.set(movesKey, set);
        return set;
    }
}
