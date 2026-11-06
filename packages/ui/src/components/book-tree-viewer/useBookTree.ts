import {
    type BookData,
    type BookTree,
    createBookTreeBuilder,
    type PositionService,
} from "@shogi/app-core";
import { useEffect, useEffectEvent, useState } from "react";

export function useBookTree(
    book: BookData | undefined,
    fetchLegalMoves: PositionService["getLegalMoves"],
) {
    const [session, setSession] = useState<{
        book: BookData;
        builder: ReturnType<typeof createBookTreeBuilder>;
    } | null>(null);
    const [revision, setRevision] = useState(0);
    const [tree, setTree] = useState<BookTree | null>(null);
    const fetch = useEffectEvent((sfen: string) => fetchLegalMoves(sfen, []));
    useEffect(() => {
        if (!book) return;
        const cache = new Map<string, Promise<string[]>>();
        const legalMoves = (sfen: string) => {
            let result = cache.get(sfen);
            if (!result) {
                result = Promise.resolve().then(() => fetch(sfen));
                cache.set(sfen, result);
            }
            return result;
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        let disposed = false;
        let publishedAt = -Infinity;
        function publish() {
            if (disposed) return;
            // 木を描き直す手間は手の数に比例するので、大きくなるほど間を空ける（組み立てを遅らせないように）。
            const interval = Math.max(50, builder.tree.nodes.length / 50);
            if (builder.tree.building && performance.now() - publishedAt < interval) {
                if (timer === undefined)
                    timer = setTimeout(() => {
                        timer = undefined;
                        publish();
                    }, interval);
                return;
            }
            clearTimeout(timer);
            timer = undefined;
            publishedAt = performance.now();
            const current = builder.tree;
            setTree({
                ...current,
                nodes: [...current.nodes],
                firstByKey: new Map(current.firstByKey),
            });
            setRevision((value) => value + 1);
        }
        const builder = createBookTreeBuilder({
            book,
            legalMoves,
            onChange: publish,
        });
        setSession({ book, builder });
        publish();
        void builder.start();
        return () => {
            disposed = true;
            clearTimeout(timer);
            timer = undefined;
            builder.cancel();
        };
    }, [book]);
    return {
        session: session && session.book === book ? session : null,
        tree: session && session.book === book ? tree : null,
        revision,
    };
}
