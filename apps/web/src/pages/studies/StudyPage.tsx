import { applyStudyOps, type StudyDocument, type StudyOp } from "@shogi/app-core";
import type { StoredStudy } from "@shogi/study-client";
import type { EngineOption, StudyWorkspaceViewState } from "@shogi/ui";
import { StudyWorkspace } from "@shogi/ui";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { Section } from "../../components/Section";
import { dispatchAuthSessionSyncEvent, useAuthSession } from "../../hooks/useAuthSession";
import { resolveBuiltinEngineIdentity } from "../../lib/builtinEngine";
import { ensureStudySession, getStudySync } from "../../lib/studySync";
import { createWebWasmEngineClient } from "../../platform/wasm-engine-client";

const engineOptions: EngineOption[] = [
    {
        id: "wasm",
        label: "内蔵エンジン",
        createClient: createWebWasmEngineClient,
        kind: "internal",
    },
];

const builtinEngine = resolveBuiltinEngineIdentity();

const routeApi = getRouteApi("/studies/$studyId");

type LoadState =
    | { status: "loading" }
    | {
          status: "ready";
          studyId: string;
          doc: StudyDocument;
          /** 前回の表示の状態（表示していた解析の設定と、見ていた局面）。 */
          view: StudyWorkspaceViewState | null;
      }
    /** ブラウザ内にもクラウドにも無い。 */
    | { status: "not_found" }
    /** ブラウザ内に無く、クラウドにも問い合わせられなかった。 */
    | { status: "unavailable"; message: string }
    /** 開いている間に削除された。 */
    | { status: "removed" };

/** ログイン状態。`error` は、確認そのものができなかった（backend に届かない、など）。 */
type SessionState = "loading" | "error" | "known";

/** 上限の名前（保存層・サーバーが返す `limit`）ごとの、その場で分かる文言。 */
const LIMIT_MESSAGE: Record<string, string> = {
    commentBytes: "コメントが長すぎます。短くしてください。",
    nodesPerStudy: "このノートの局面の数が上限に達しました。",
    lineLength: "このノートの手数が上限に達しました。",
    layersPerStudy: "解析の設定が多すぎます（1 つのノートに 8 種類まで）。",
    titleLength: "表題が長すぎます。",
    treeBytes: "棋譜と変化が大きすぎます。これ以上、手やコメントを足せません。",
    layerResultsBytes:
        "この設定の解析結果が保存できる上限に達しました。解析を止めました（ここまでの結果は残っています）。",
};

/** 変更を保存できなかった理由を、利用者向けの文言にする。 */
function describeOpError(error: unknown): string {
    const fields = error !== null && typeof error === "object" ? error : {};
    const limit = "limit" in fields ? fields.limit : undefined;
    if (typeof limit === "string" && Object.hasOwn(LIMIT_MESSAGE, limit)) {
        return LIMIT_MESSAGE[limit];
    }
    if ("code" in fields && fields.code === "not_found") {
        return "このノートに変更を保存できませんでした（ログアウトしたか、削除された可能性があります）。";
    }
    const detail = error instanceof Error ? error.message : String(error);
    return `変更を保存できませんでした: ${detail}`;
}

/** ログインへ進む先。ログイン後は元のノートの画面へ戻る。 */
const loginHref = (studyId: string): string =>
    `/auth?next=${encodeURIComponent(`/studies/${studyId}`)}`;

/** 元の棋譜へのリンク。貼り付けた棋譜には無い。 */
function renderOriginLink(origin: StudyDocument["origin"]): ReactNode {
    const className =
        "text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    if (origin.ref === null) return undefined;
    if (origin.kind === "rshogi_csa") {
        return (
            <Link to="/rshogi-viewer/$gameId" params={{ gameId: origin.ref }} className={className}>
                元の棋譜を開く
            </Link>
        );
    }
    if (origin.kind === "game_record") {
        return (
            <Link to="/games/$gameId" params={{ gameId: origin.ref }} className={className}>
                元の対局を開く
            </Link>
        );
    }
    return undefined;
}

function StudyStateCard({ title, children }: { title: string; children: ReactNode }): ReactElement {
    return (
        <PageContainer width="narrow">
            <Section title={title}>
                {children}
                <Link
                    to="/studies"
                    className="self-start text-sm text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light"
                >
                    研究ノートの一覧へ
                </Link>
            </Section>
        </PageContainer>
    );
}

export default function StudyPage(): ReactElement {
    const { studyId } = routeApi.useParams();
    const navigate = useNavigate();
    const { session, isLoadingSession } = useAuthSession();
    const sessionState: SessionState = isLoadingSession
        ? "loading"
        : session === null
          ? "error"
          : "known";
    const userId = session?.authenticated ? session.user.id : null;
    const sync = getStudySync();
    const [state, setState] = useState<LoadState>({ status: "loading" });
    const [reloadCount, setReloadCount] = useState(0);
    const [notice, setNotice] = useState<{ id: number; text: string; type: "error" } | null>(null);
    const saveStatus = useSyncExternalStore(
        (listener) => sync.subscribeStatus(studyId, listener),
        () => sync.getStatus(studyId),
    );

    // ノートごとの、こちらの編集の進み具合。
    // - `seq`: 編集のたびに増える。保存層から読み直している間に編集があったかを見分ける。
    // - `pending`: 保存層への書き込みを待っている数。
    const writesRef = useRef(new Map<string, { seq: number; pending: number }>());
    const writesOf = (id: string): { seq: number; pending: number } => {
        let entry = writesRef.current.get(id);
        if (!entry) {
            entry = { seq: 0, pending: 0 };
            writesRef.current.set(id, entry);
        }
        return entry;
    };

    /**
     * 保存層の内容を画面に取り込む（他のタブ・端末の変更、拒否された操作の取り消し）。
     * 読んでいる間にこちらで編集があったら、古い内容で上書きしないよう、読み直す。
     */
    const reloadFromStore = async (targetId: string, isCancelled: () => boolean): Promise<void> => {
        const writes = writesOf(targetId);
        for (;;) {
            const seq = writes.seq;
            await sync.whenLocalWritesSettled();
            let stored: StoredStudy | null;
            try {
                stored = await sync.load(targetId);
            } catch {
                return;
            }
            if (isCancelled()) return;
            if (writes.seq !== seq) continue;
            if (!stored) return;
            if (stored.mergedInto !== null) {
                void navigate({
                    to: "/studies/$studyId",
                    params: { studyId: stored.mergedInto },
                    replace: true,
                });
                return;
            }
            const doc = stored.doc;
            setState((previous) =>
                previous.status === "ready" && previous.studyId === targetId
                    ? { ...previous, doc }
                    : previous,
            );
            return;
        }
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies: reloadCount は「もう一度読み込む」で開き直すための合図。reloadFromStore は毎回作り直されるが、中身は ref と studyId だけに依存する
    useEffect(() => {
        let cancelled = false;
        const isCancelled = (): boolean => cancelled;
        // 同じノートを開き直すだけのとき（ログイン状態が変わった、など）は、画面を作り直さない
        // （作り直すと、実行中の解析が止まってしまう）。
        setState((previous) =>
            previous.status === "ready" && previous.studyId === studyId
                ? previous
                : { status: "loading" },
        );

        const goTo = (targetId: string): void => {
            void navigate({
                to: "/studies/$studyId",
                params: { studyId: targetId },
                replace: true,
            });
        };

        /** 前回の表示の状態を読む（このブラウザだけの状態。読めなくても画面は開く）。 */
        const loadView = async (): Promise<StudyWorkspaceViewState | null> => {
            try {
                const stored = await sync.getViewState(studyId);
                return {
                    selectedLayerId:
                        typeof stored.selectedLayerId === "string" ? stored.selectedLayerId : null,
                    currentNodeId:
                        typeof stored.currentNodeId === "string" ? stored.currentNodeId : null,
                };
            } catch {
                return null;
            }
        };

        /** 開けた文書を画面に出す。開き直しでは、画面が持っている表示の状態をそのまま使う。 */
        const show = async (doc: StudyDocument): Promise<void> => {
            const view = await loadView();
            if (cancelled) return;
            setState((previous) => ({
                status: "ready",
                studyId,
                doc,
                view:
                    previous.status === "ready" && previous.studyId === studyId
                        ? previous.view
                        : view,
            }));
        };

        const unsubscribe = sync.subscribeEvents((event) => {
            if (cancelled) return;
            if (event.type === "unauthorized") {
                // セッションが切れた。ログイン状態を取り直すと、保存の案内が「ログインすると…」に変わる。
                dispatchAuthSessionSyncEvent();
                return;
            }
            if (event.studyId !== studyId) return;
            if (event.type === "merged") {
                // 同じ元棋譜のノートが既にあった。成果はそのノートに統合済み。
                goTo(event.into);
            } else if (event.type === "removed") {
                setState({ status: "removed" });
            } else if (event.origin !== "local") {
                // 他のタブ・他の端末の変更を取り込む。
                void reloadFromStore(studyId, isCancelled);
            }
        });

        void (async () => {
            if (sessionState !== "known") {
                // ログイン状態が分かる前に出してよいのは、匿名のノート（未ログイン中に作ったノート）だけ。
                // アカウントのノートは保存層が返さない（`load` が null）。その場合は「見つかりません」と
                // 決めつけず、ログイン状態が分かるまで読み込み中のままにする。
                const stored = await sync.load(studyId);
                if (cancelled) return;
                if (stored && !stored.deleting) {
                    if (stored.mergedInto !== null) {
                        goTo(stored.mergedInto);
                        return;
                    }
                    await show(stored.doc);
                    return;
                }
                if (sessionState === "error") {
                    setState((previous) =>
                        previous.status === "ready" && previous.studyId === studyId
                            ? previous
                            : {
                                  status: "unavailable",
                                  message: "ログイン状態を確認できませんでした。",
                              },
                    );
                }
                return;
            }
            // ログイン状態を伝え、未ログイン中に作ったノートをアカウントへ引き継いでから開く。
            await ensureStudySession(userId);
            // 開き直すときに、書きかけの変更を古い内容で上書きしないよう、書き込みが終わるのを待つ。
            await sync.whenLocalWritesSettled();
            const result = await sync.open(studyId);
            if (cancelled) return;
            if (result.status === "ok") {
                await show(result.study.doc);
            } else if (result.status === "merged") {
                goTo(result.into);
            } else if (result.status === "unavailable") {
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
            // 画面を離れるときは、間引きを待たずに送る。
            void sync.flush(studyId).catch(() => undefined);
        };
    }, [studyId, sessionState, userId, sync, navigate, reloadCount]);

    /**
     * 編集の操作を画面にすぐ反映し、保存層（ブラウザ内 → クラウド）へ流す。
     * 保存層が受け付けなかったら、理由を出して画面を保存済みの内容に戻し、`false` を返す。
     *
     * `targetId` は、この関数を渡した画面のノート。画面を離れたあとに届いた操作（解析の残りの
     * 結果など）が、次に開いたノートの表示を変えないよう、必ずこの ID に対して行う。
     */
    const applyOpsTo = (targetId: string, ops: StudyOp[]): Promise<boolean> => {
        const writes = writesOf(targetId);
        writes.seq += 1;
        writes.pending += 1;
        setState((previous) => {
            if (previous.status !== "ready" || previous.studyId !== targetId) return previous;
            try {
                return { ...previous, doc: applyStudyOps(previous.doc, ops) };
            } catch {
                // 形の正しくない操作。保存層も同じ理由で拒否するので、理由はそちらで出す。
                return previous;
            }
        });
        return sync.applyOps(targetId, ops).then(
            (doc) => {
                writes.pending -= 1;
                // 待っている書き込みが無くなったら、保存層の内容に揃える。
                if (writes.pending === 0) {
                    setState((previous) =>
                        previous.status === "ready" && previous.studyId === targetId
                            ? { ...previous, doc }
                            : previous,
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
                void reloadFromStore(targetId, () => false);
                return false;
            },
        );
    };

    const handleLogin = (): void => {
        // OAuth でページが遷移するので、ブラウザ内への書き込みが終わってから進む。
        void sync
            .whenLocalWritesSettled()
            .catch(() => undefined)
            .then(() => {
                window.location.assign(loginHref(studyId));
            });
    };

    const handleDiscard = (): void => {
        void sync
            .deleteStudy(studyId)
            .then(() => navigate({ to: "/studies" }))
            .catch((error: unknown) => {
                console.error("[study] ノートを削除できませんでした", error);
            });
    };

    // パンくずは表示名をキーにするので、一覧の「研究ノート」と同じ名前にならないようにする。
    const title =
        state.status === "ready" && state.doc.title !== "研究ノート" ? state.doc.title : "ノート";

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "研究ノート", to: "/studies" },
                    { label: title },
                ]}
                right={<HeaderNav />}
            />
            {state.status === "loading" && (
                <PageContainer width="narrow">
                    <p aria-live="polite" className="text-sm text-muted-foreground">
                        研究ノートを読み込み中...
                    </p>
                </PageContainer>
            )}
            {state.status === "not_found" && (
                <StudyStateCard title="研究ノートが見つかりません">
                    <p className="text-sm text-muted-foreground">
                        このブラウザにも、アカウントにも、この研究ノートはありません。削除されたか、別のアカウントのノートの可能性があります。
                    </p>
                    {userId === null && (
                        <p className="text-sm text-muted-foreground">
                            アカウントに保存したノートは、
                            <a
                                href={loginHref(studyId)}
                                className="text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light"
                            >
                                ログイン
                            </a>
                            すると開けます。
                        </p>
                    )}
                </StudyStateCard>
            )}
            {state.status === "unavailable" && (
                <StudyStateCard title="研究ノートを読み込めませんでした">
                    <p className="text-sm text-muted-foreground">
                        通信できなかった可能性があります。接続を確かめて、もう一度お試しください。
                    </p>
                    <p className="text-xs text-muted-foreground">{state.message}</p>
                    <button
                        type="button"
                        onClick={() => setReloadCount((count) => count + 1)}
                        className="self-start rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                    >
                        もう一度読み込む
                    </button>
                </StudyStateCard>
            )}
            {state.status === "removed" && (
                <StudyStateCard title="この研究ノートは削除されました">
                    <p className="text-sm text-muted-foreground">
                        このノートは、このブラウザから削除されました。
                    </p>
                </StudyStateCard>
            )}
            {state.status === "ready" && state.studyId === studyId && (
                // 画面の中央寄せは、ここ（親）で行う。
                <div className="flex flex-col">
                    <StudyWorkspace
                        key={studyId}
                        doc={state.doc}
                        onApplyOps={(ops) => applyOpsTo(studyId, ops)}
                        onFlush={() => void sync.flush(studyId).catch(() => undefined)}
                        saveStatus={saveStatus}
                        onRetrySave={() => void sync.retry(studyId).catch(() => undefined)}
                        onLogin={handleLogin}
                        onDiscard={handleDiscard}
                        originLink={renderOriginLink(state.doc.origin)}
                        initialView={state.view}
                        onViewChange={(view) => {
                            void sync.setViewState(studyId, { ...view }).catch(() => undefined);
                        }}
                        notice={notice}
                        engineOptions={engineOptions}
                        manifestUrl={import.meta.env.VITE_NNUE_MANIFEST_URL as string}
                        defaultNnuePresetKey={import.meta.env.VITE_DEFAULT_NNUE_PRESET}
                        engine={builtinEngine}
                    />
                </div>
            )}
        </>
    );
}
