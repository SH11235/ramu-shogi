import {
    type BookData,
    type BookTree,
    createBookTreeBuilder,
    type PositionService,
    type PositionState,
} from "@shogi/app-core";
import { useEffect, useEffectEvent, useState } from "react";

export function useBookTree(
    book: BookData | undefined,
    side: PositionState["turn"],
    fetchLegalMoves: PositionService["getLegalMoves"],
) {
    const [session, setSession] = useState<{
        book: BookData;
        side: PositionState["turn"];
        builder: ReturnType<typeof createBookTreeBuilder>;
        legalMoves: (sfen: string) => Promise<string[]>;
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
            if (builder.tree.building && performance.now() - publishedAt < 50) {
                if (timer === undefined)
                    timer = setTimeout(() => {
                        timer = undefined;
                        publish();
                    }, 50);
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
                unreachable: [...current.unreachable],
            });
            setRevision((value) => value + 1);
        }
        const builder = createBookTreeBuilder({
            book,
            side,
            legalMoves,
            onChange: publish,
        });
        setSession({ book, side, builder, legalMoves });
        publish();
        void builder.start();
        return () => {
            disposed = true;
            clearTimeout(timer);
            timer = undefined;
            builder.cancel();
        };
    }, [book, side]);
    return {
        session: session && session.book === book && session.side === side ? session : null,
        tree: session && session.book === book && session.side === side ? tree : null,
        revision,
    };
}
