/**
 * 研究ノートの画面（Desktop）。
 *
 * この端末に保存してあるノートを開き、編集の操作を保存層へ流す。Web のページ
 * （`apps/web/src/pages/studies/StudyPage.tsx`）から、ログイン・クラウド同期に関わる部分
 * （持ち主の確認、編集の停止、書きかけのコメントの退避）を除いたもの。
 */

import { applyStudyOps, STUDY_LIMITS, type StudyDocument, type StudyOp } from "@shogi/app-core";
import { getLegalMoves } from "@shogi/engine-tauri";
import type { StoredStudy, StudySync } from "@shogi/study-client";
import type { EngineOption, PlayFromPosition, StudyWorkspaceViewState } from "@shogi/ui";
import { NnueLibraryDialog, StudyWorkspace } from "@shogi/ui";
import { Button } from "@shogi/ui/components/button";
import type { ReactElement } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { requestNnueFilePath } from "../../platform/nnueFilePicker";
import { getDesktopStudySync } from "../../studies/desktopStudySync";

interface Props {
    studyId: string;
    /** 解析に使えるエンジン（内蔵エンジンと、登録済みの外部エンジン）。 */
    engineOptions: EngineOption[];
    onBackToList: () => void;
    onBackToLocal: () => void;
    /** 「この局面から対局」。いま見ている局面を、ローカル対局へ引き継ぐ。 */
    onPlayFromPosition: (position: PlayFromPosition) => void;
    /** 同期エンジンの差し替え（テスト用）。省略時はアプリのもの。 */
    sync?: StudySync;
}

type LoadState =
    | { status: "loading" }
    | { status: "ready"; doc: StudyDocument; view: StudyWorkspaceViewState | null }
    | { status: "not_found" }
    | { status: "removed" }
    | { status: "unavailable"; message: string };

const nnueManifestUrl = import.meta.env.VITE_NNUE_MANIFEST_URL as string;

/**
 * 内蔵エンジン（Tauri のネイティブの rshogi）の、解析結果を分けるための識別情報。
 * 版は build 時に Cargo.lock の rshogi-core から埋め込まれる（`vite.config.ts`）。取れなければ
 * null（アプリの版で代用される）。
 */
const builtinEngine = {
    kind: "native" as const,
    name: "rshogi",
    version: import.meta.env.VITE_RSHOGI_CORE_VERSION?.trim() || null,
    appVersion: import.meta.env.VITE_APP_VERSION?.trim() || "0.0.0",
};

/** 上限の名前（保存層が返す `limit`）ごとの、その場で分かる文言。 */
const LIMIT_MESSAGE: Record<string, string> = {
    commentBytes: "コメントが長すぎます。短くしてください。",
    nodesPerStudy: "このノートの局面の数が上限に達しました。",
    lineLength: "このノートの手数が上限に達しました。",
    layersPerStudy: `解析の設定が多すぎます（1 つのノートに ${STUDY_LIMITS.layersPerStudy} 種類まで）。`,
    titleLength: "表題が長すぎます。",
    treeBytes: "棋譜と変化が大きすぎます。これ以上、手やコメントを足せません。",
    layerResultsBytes:
        "この設定の解析結果が保存できる上限に達しました。解析を止めました（ここまでの結果は残っています）。",
};

function describeOpError(error: unknown): string {
    const fields = error !== null && typeof error === "object" ? error : {};
    const limit = "limit" in fields ? fields.limit : undefined;
    if (typeof limit === "string" && Object.hasOwn(LIMIT_MESSAGE, limit)) {
        return LIMIT_MESSAGE[limit];
    }
    const detail = error instanceof Error ? error.message : String(error);
    return `変更を保存できませんでした: ${detail}`;
}

export function StudyView({
    studyId,
    engineOptions,
    onBackToList,
    onBackToLocal,
    onPlayFromPosition,
    sync = getDesktopStudySync(),
}: Props): ReactElement {
    const [state, setState] = useState<LoadState>({ status: "loading" });
    const [notice, setNotice] = useState<{ id: number; text: string; type: "error" } | null>(null);
    const [isNnueLibraryOpen, setIsNnueLibraryOpen] = useState(false);
    const saveStatus = useSyncExternalStore(
        (listener) => sync.subscribeStatus(studyId, listener),
        () => sync.getStatus(studyId),
    );

    // こちらの編集の進み具合。`seq` は編集のたびに増え、保存層から読み直している間に編集が
    // あったかを見分ける。`pending` は、保存層への書き込みを待っている数。
    const writesRef = useRef({ seq: 0, pending: 0 });

    /**
     * 保存層の内容を画面に出す。読んでいる間にこちらで編集があったら、古い内容で上書きしない
     * よう、読み直す。
     *
     * @returns 保存層にノートが無かったら false。
     */
    const presentFromStore = async (
        mode: "open" | "refresh",
        isCancelled: () => boolean,
    ): Promise<boolean> => {
        const writes = writesRef.current;
        // 表示の状態（見ていた局面など）は、最初に開くときにだけ使う。読めなくても開く。
        let view: StudyWorkspaceViewState | null = null;
        if (mode === "open") {
            try {
                const stored = await sync.getViewState(studyId);
                view = {
                    selectedLayerId:
                        typeof stored.selectedLayerId === "string" ? stored.selectedLayerId : null,
                    currentNodeId:
                        typeof stored.currentNodeId === "string" ? stored.currentNodeId : null,
                };
            } catch {
                view = null;
            }
        }
        for (;;) {
            const seq = writes.seq;
            await sync.whenLocalWritesSettled();
            let stored: StoredStudy | null;
            try {
                stored = await sync.load(studyId);
            } catch (error) {
                // 読めなかっただけで、ノートが無いとは限らない。開くときは「読めない」と出す。
                if (mode !== "open") return false;
                if (!isCancelled()) {
                    setState({
                        status: "unavailable",
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
                return true;
            }
            if (isCancelled()) return true;
            // 読んでいる間に編集があった。いま読んだ内容は古いので、読み直す。
            if (writes.seq !== seq) continue;
            if (!stored || stored.deleting) return false;
            const { doc } = stored;
            setState((previous) => {
                // 開いている画面の更新では、表示の状態は画面が持っているものを使う。
                if (previous.status === "ready") return { ...previous, doc };
                if (mode === "refresh") return previous;
                return { status: "ready", doc, view };
            });
            return true;
        }
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies: presentFromStore は毎回作り直されるが、中身は ref と引数だけに依存する
    useEffect(() => {
        let cancelled = false;
        const isCancelled = (): boolean => cancelled;
        setState({ status: "loading" });
        writesRef.current = { seq: 0, pending: 0 };

        const unsubscribe = sync.subscribeEvents((event) => {
            if (cancelled || !("studyId" in event) || event.studyId !== studyId) return;
            if (event.type === "removed") {
                setState({ status: "removed" });
            } else if (event.type === "document" && event.origin !== "local") {
                void presentFromStore("refresh", isCancelled);
            }
        });

        void (async () => {
            const result = await sync.open(studyId);
            if (cancelled) return;
            if (result.status === "ok" && (await presentFromStore("open", isCancelled))) return;
            if (cancelled) return;
            if (result.status === "unavailable") {
                setState({ status: "unavailable", message: result.message });
            } else {
                setState({ status: "not_found" });
            }
        })().catch((error: unknown) => {
            if (cancelled) return;
            setState({
                status: "unavailable",
                message: error instanceof Error ? error.message : String(error),
            });
        });

        return () => {
            cancelled = true;
            unsubscribe();
            sync.close(studyId);
            void sync.flush(studyId).catch(() => undefined);
        };
    }, [studyId, sync]);

    /**
     * 編集の操作を画面にすぐ反映し、保存層へ流す。保存層が受け付けなかったら、理由を出して
     * 画面を保存済みの内容に戻し、`false` を返す。
     */
    const applyOps = (ops: StudyOp[]): Promise<boolean> => {
        const writes = writesRef.current;
        writes.seq += 1;
        writes.pending += 1;
        setState((previous) => {
            if (previous.status !== "ready") return previous;
            try {
                return { ...previous, doc: applyStudyOps(previous.doc, ops) };
            } catch {
                // 形の正しくない操作。保存層も同じ理由で拒否するので、理由はそちらで出す。
                return previous;
            }
        });
        return sync.applyOps(studyId, ops).then(
            (doc) => {
                writes.pending -= 1;
                // 待っている書き込みが無くなったら、保存層の内容に揃える。
                if (writes.pending === 0) {
                    setState((previous) =>
                        previous.status === "ready" ? { ...previous, doc } : previous,
                    );
                }
                return true;
            },
            (error: unknown) => {
                writes.pending -= 1;
                console.error("[study] 変更を保存できませんでした", error);
                setNotice((previous) => ({
                    id: (previous?.id ?? 0) + 1,
                    text: describeOpError(error),
                    type: "error",
                }));
                // 画面に先に反映していた分を取り消す（保存されている内容に戻す）。
                writes.seq += 1;
                void presentFromStore("refresh", () => false);
                return false;
            },
        );
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 px-3 pt-2 md:px-4">
                <Button variant="outline" size="sm" onClick={onBackToLocal}>
                    ← ローカル対局へ戻る
                </Button>
                <Button variant="outline" size="sm" onClick={onBackToList}>
                    ← 研究ノートの一覧へ戻る
                </Button>
            </div>
            {state.status === "loading" && (
                <p aria-live="polite" className="px-4 text-sm text-muted-foreground">
                    研究ノートを読み込み中...
                </p>
            )}
            {state.status === "not_found" && (
                <p className="px-4 text-sm text-muted-foreground">
                    この研究ノートは、この端末にありません。削除された可能性があります。
                </p>
            )}
            {state.status === "removed" && (
                <p className="px-4 text-sm text-muted-foreground">
                    この研究ノートは削除されました。
                </p>
            )}
            {state.status === "unavailable" && (
                <p role="alert" className="px-4 text-sm text-destructive">
                    研究ノートを読み込めませんでした: {state.message}
                </p>
            )}
            {state.status === "ready" && (
                <div className="flex flex-col">
                    <StudyWorkspace
                        key={studyId}
                        doc={state.doc}
                        onApplyOps={applyOps}
                        onFlush={() => void sync.flush(studyId).catch(() => undefined)}
                        saveStatus={saveStatus}
                        onRetrySave={() => void sync.retry(studyId).catch(() => undefined)}
                        onPlayFromPosition={onPlayFromPosition}
                        // 保存先はこの端末だけ（ログインの仕組みが無い）。
                        localOnly
                        fetchLegalMoves={(sfen, moves, options) =>
                            getLegalMoves({ sfen, moves, passRights: options?.passRights })
                        }
                        initialView={state.view}
                        onViewChange={(view) => {
                            void sync.setViewState(studyId, { ...view }).catch(() => undefined);
                        }}
                        notice={notice}
                        engineOptions={engineOptions}
                        manifestUrl={nnueManifestUrl}
                        defaultNnuePresetKey={import.meta.env.VITE_DEFAULT_NNUE_PRESET}
                        engine={builtinEngine}
                        onOpenNnueLibrary={() => setIsNnueLibraryOpen(true)}
                    />
                </div>
            )}
            <NnueLibraryDialog
                open={isNnueLibraryOpen}
                onOpenChange={setIsNnueLibraryOpen}
                manifestUrl={nnueManifestUrl}
                onRequestFilePath={requestNnueFilePath}
            />
        </div>
    );
}
