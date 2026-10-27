import { useEffect, useEffectEvent, useRef } from "react";
import { infinitySafeReplacer } from "../utils/infinitySafeReplacer";
import type { ReviewMoveEval } from "./useKifuImportExport";
import type { useKifuNavigation } from "./useKifuNavigation";

const reviewMoveDataKeyCache = new WeakMap<(ReviewMoveEval | undefined)[], string>();

export const stringifyReviewMoveData = (
    moveData: (ReviewMoveEval | undefined)[] | undefined,
): string => {
    if (!moveData) return "";
    const cached = reviewMoveDataKeyCache.get(moveData);
    if (cached !== undefined) return cached;

    const key = JSON.stringify(moveData, infinitySafeReplacer);
    reviewMoveDataKeyCache.set(moveData, key);
    return key;
};

interface LoadedReviewSignature {
    sfen: string;
    movesKey: string;
    moveDataKey: string;
}

export interface InitialReviewInput {
    sfen: string;
    moves: string[];
    moveData?: (ReviewMoveEval | undefined)[];
    /**
     * 最初に取り込んだときに開く局面。`"start"` は開始局面、省略時は最終手（観戦は最新手を追う）。
     * 取り込んだ後の更新（手が伸びた・評価値が届いた）には効かない。
     */
    openAt?: "start";
}

type InitialReviewSyncMode = "skip" | "import" | "diff";

interface ReviewMoveDataDiffResult {
    changed: number;
    applied: number;
    skipped: number;
}

export const getInitialReviewSyncMode = (
    loaded: LoadedReviewSignature | null,
    next: LoadedReviewSignature,
): InitialReviewSyncMode => {
    if (!loaded) return "import";
    if (loaded.sfen !== next.sfen || loaded.movesKey !== next.movesKey) return "import";
    if (loaded.moveDataKey !== next.moveDataKey) return "diff";
    return "skip";
};

const isSameReviewMoveEval = (
    a: ReviewMoveEval | undefined,
    b: ReviewMoveEval | undefined,
): boolean =>
    a?.elapsedMs === b?.elapsedMs && a?.evalCp === b?.evalCp && a?.evalMate === b?.evalMate;

export const applyReviewMoveDataDiff = (
    navigation: Pick<ReturnType<typeof useKifuNavigation>, "updateMoveEvalAtPly">,
    moves: string[],
    previousMoveData: (ReviewMoveEval | undefined)[] | undefined,
    nextMoveData: (ReviewMoveEval | undefined)[] | undefined,
): ReviewMoveDataDiffResult => {
    const result: ReviewMoveDataDiffResult = { changed: 0, applied: 0, skipped: 0 };
    for (let index = 0; index < moves.length; index++) {
        const data = nextMoveData?.[index];
        if (isSameReviewMoveEval(previousMoveData?.[index], data)) continue;

        result.changed++;
        // 評価値のクリアは diff 経路では非対応。moves 変化時の import 経路で
        // 棋譜ツリーを再構築し、その際に古い評価値もリセットされる。
        if (!data) continue;
        const updateResult = navigation.updateMoveEvalAtPly(
            index + 1,
            {
                elapsedMs: data.elapsedMs,
                scoreCp: data.evalCp,
                scoreMate: data.evalMate,
                pv: data.pv,
            },
            {
                usiMove: moves[index],
            },
        );
        if (updateResult === "missing") {
            result.skipped++;
        } else {
            result.applied++;
        }
    }
    return result;
};

export function useInitialReviewSync({
    positionReady,
    initialReview,
    navigation,
    importSfen,
}: {
    positionReady: boolean;
    initialReview: InitialReviewInput | undefined;
    navigation: ReturnType<typeof useKifuNavigation>;
    importSfen: (
        sfen: string,
        moves: string[],
        options?: {
            gotoPly?: number;
            isStale?: () => boolean;
            moveData?: (ReviewMoveEval | undefined)[];
        },
    ) => Promise<void>;
}): void {
    const loadedReviewRef = useRef<LoadedReviewSignature | null>(null);
    const loadedReviewMoveDataRef = useRef<(ReviewMoveEval | undefined)[] | undefined>(undefined);
    const importSfenRef = useRef(importSfen);
    importSfenRef.current = importSfen;
    const navigationRef = useRef(navigation);
    navigationRef.current = navigation;
    const reviewSfen = initialReview?.sfen;
    const reviewMoves = initialReview?.moves;
    const reviewMoveData = initialReview?.moveData;
    const reviewMoveDataKey = stringifyReviewMoveData(reviewMoveData);
    const getLatestReview = useEffectEvent(() => initialReview);
    const applyLatestReviewMoveDataDiff = useEffectEvent((moves: string[]) => {
        const nextMoveData = getLatestReview()?.moveData;
        const result = applyReviewMoveDataDiff(
            navigationRef.current,
            moves,
            loadedReviewMoveDataRef.current,
            nextMoveData,
        );
        if (result.skipped === 0) {
            loadedReviewMoveDataRef.current = nextMoveData;
        }
        return result;
    });

    useEffect(() => {
        if (!positionReady || reviewSfen === undefined || reviewMoves === undefined) {
            return;
        }
        const movesKey = reviewMoves.join(" ");
        const loaded = loadedReviewRef.current;
        const nextSignature = {
            sfen: reviewSfen,
            movesKey,
            moveDataKey: reviewMoveDataKey,
        };
        const syncMode = getInitialReviewSyncMode(loaded, nextSignature);
        if (syncMode === "skip") {
            return;
        }
        if (syncMode === "diff") {
            const result = applyLatestReviewMoveDataDiff(reviewMoves);
            if (result.skipped === 0) {
                loadedReviewRef.current = nextSignature;
            }
            return;
        }

        // 再構築前のカーソルを捕捉する。末尾追従中 (currentPly === totalPly) なら
        // 最新手まで進め、途中検討中ならその ply を維持する。
        const navState = navigationRef.current.state;
        const wasFollowingTip = navState.currentPly === navState.totalPly;
        const restorePly = navState.currentPly;
        // 最初の取り込みだけ、開始局面から開く指定に従う。
        const openAtStart = loaded === null && getLatestReview()?.openAt === "start";

        // await 前に確定して StrictMode の二重実行を冪等化する。連続着手で先行 import が
        // 後着 import に追い越されたら、isStale で古い import の state 適用を中止する。
        loadedReviewRef.current = nextSignature;
        const importMoveData = getLatestReview()?.moveData;
        loadedReviewMoveDataRef.current = importMoveData;
        void importSfenRef
            .current(reviewSfen, reviewMoves, {
                gotoPly: openAtStart ? 0 : wasFollowingTip ? undefined : restorePly,
                moveData: importMoveData,
                isStale: () =>
                    loadedReviewRef.current?.sfen !== reviewSfen ||
                    loadedReviewRef.current?.movesKey !== movesKey ||
                    loadedReviewRef.current?.moveDataKey !== reviewMoveDataKey,
            })
            .then(() => {
                // importSfen の resolve 時点では React の commit が未完了のことがあるため、
                // macrotask (setTimeout 0) に後退させ、commit 後の navigationRef
                // (updateMoveEvalAtPly の missing 判定が参照するツリー) に対して
                // import 中に届いたコメント評価値の diff を再適用する。
                // (.then() 時点では既に非同期コンテキストのため flushSync による
                // 同期 commit の強制は使えない)
                setTimeout(() => {
                    if (
                        loadedReviewRef.current?.sfen !== reviewSfen ||
                        loadedReviewRef.current?.movesKey !== movesKey
                    ) {
                        return;
                    }
                    const latestReview = getLatestReview();
                    if (
                        latestReview?.sfen !== reviewSfen ||
                        latestReview.moves.join(" ") !== movesKey
                    ) {
                        return;
                    }
                    const latestMoveData = latestReview.moveData;
                    const result = applyReviewMoveDataDiff(
                        navigationRef.current,
                        reviewMoves,
                        loadedReviewMoveDataRef.current,
                        latestMoveData,
                    );
                    // skipped > 0 (ply 未登録等) の場合は ref を確定せず、
                    // 次の reviewMoveData 変化時に同じ差分の再適用を試みる (リトライ)。
                    // 差分適用は冪等なので重複適用の害はない。
                    if (result.skipped === 0) {
                        loadedReviewMoveDataRef.current = latestMoveData;
                        loadedReviewRef.current = {
                            sfen: reviewSfen,
                            movesKey,
                            moveDataKey: stringifyReviewMoveData(latestMoveData),
                        };
                    }
                }, 0);
            })
            .catch((err) => {
                // SFEN 解析失敗などで取り込みが reject したら loaded マークを巻き戻し、
                // 同一内容の再取り込み (再 snapshot 等) を可能にする。より新しい取り込みが
                // 先行していれば (参照不一致) リセットしない。
                if (
                    loadedReviewRef.current?.sfen === reviewSfen &&
                    loadedReviewRef.current?.movesKey === movesKey &&
                    loadedReviewRef.current?.moveDataKey === reviewMoveDataKey
                ) {
                    loadedReviewRef.current = null;
                    loadedReviewMoveDataRef.current = undefined;
                }
                console.error("[rshogi] initialReview の取り込みに失敗しました", err);
            });
    }, [positionReady, reviewSfen, reviewMoves, reviewMoveDataKey]);
}
