/**
 * 合法手キャッシュのキーを作る。合法手を決める入力（開始局面・指し手列・パス権）をすべて含める。
 *
 * @param startSfen - 開始局面
 * @param moves - 開始局面からの指し手列
 * @param passRightsOption - 合法手の取得に渡すパス権オプション（usePassRights の getPassRightsOption）
 */
export function buildLegalCacheKey(
    startSfen: string,
    moves: readonly string[],
    passRightsOption?: { passRights?: { sente: number; gote: number } },
): string {
    const passRights = passRightsOption?.passRights;
    return JSON.stringify([
        startSfen,
        moves.join(" "),
        passRights ? [passRights.sente, passRights.gote] : null,
    ]);
}

/**
 * 合法手のキャッシュを管理するクラス
 *
 * 局面のキー（movesKey）ごとに合法手のセットをキャッシュし、同じ局面での重複計算を避けます。
 *
 * キーは {@link buildLegalCacheKey} で作ること。合法手は「開始局面・指し手列・パス権」で決まるので、
 * 指し手列だけをキーにすると、開始局面を読み込み直した後に前の局面の合法手が当たってしまう。
 *
 * 取得中に {@link LegalMoveCache.clear} が呼ばれたら、その取得の結果は保存しない（世代で見分ける）。
 * クリアは「局面が入れ替わった」合図なので、後から届いた古い局面の応答で上書きさせない。
 */
export class LegalMoveCache {
    private cache: { movesKey: string; moves: Set<string> } | null = null;
    /** clear() のたびに進む世代。取得を始めた時の世代と違えば、その結果は保存しない */
    private generation = 0;

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
        this.generation += 1;
    }

    /**
     * 指定された指し手列の合法手を取得する（キャッシュ優先）
     *
     * 解決を待つ間に clear() されたときは、結果を呼び出し元へ返すだけでキャッシュには入れない。
     *
     * @param movesKey - 現在の局面のキー（buildLegalCacheKey の戻り値）
     * @param resolver - 合法手を解決する非同期関数
     * @returns 合法手のセット
     *
     * @example
     * ```typescript
     * const cache = new LegalMoveCache();
     * const moves = ["7g7f", "3c3d"];
     * const movesKey = buildLegalCacheKey(startSfen, moves, passRightsOption);
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

        const generation = this.generation;
        const list = await resolver();
        const set = new Set(list);
        if (generation === this.generation) {
            this.set(movesKey, set);
        }
        return set;
    }
}
