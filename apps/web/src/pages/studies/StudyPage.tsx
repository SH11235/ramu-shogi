import { applyStudyOps, STUDY_LIMITS, type StudyDocument, type StudyOp } from "@shogi/app-core";
import type { StoredStudy } from "@shogi/study-client";
import type { EngineOption, StudyCommentDraft, StudyWorkspaceViewState } from "@shogi/ui";
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
import {
    applyStudyCommentDraftChange,
    readStudyCommentDrafts,
    removeStudyCommentDrafts,
} from "../../lib/studyDrafts";
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
          /** ノートの持ち主（匿名のノートは null）。 */
          ownerId: string | null;
          /**
           * 開いている間にログインが切れて、ノートが見えなくなった（保存できない）。
           * 「見つかりません」にはせず、画面を残して編集だけを止める。
           */
          locked: boolean;
          /** 前回、保存できないまま残っていたコメントの入力（手ごと）。 */
          drafts: StudyCommentDraft[];
          /**
           * 画面の文書が、サーバーの最新の内容を取り込んだものか（取り込む相手がいないノートは
           * 常に true）。false の間は、コメントの下書きを自動では保存しない。
           */
          fresh: boolean;
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

/** コメントとして保存できる長さか（長すぎる下書きは、短くするまで保存されない）。 */
const fitsCommentLimit = (text: string): boolean =>
    new TextEncoder().encode(text).length <= STUDY_LIMITS.commentBytes;

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
    const { session, isLoadingSession, sessionError, refreshSession } = useAuthSession();
    // 取り直しに失敗して前の値が残っているだけのときは、その値を同期エンジンへ伝え直さない。
    const sessionConfirmed = sessionError === null;
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

    // ノートを開いたときに戻した書きかけの内容（ノート → 手 → 内容）。この画面が引き継いだ
    // 書きかけとして、置き換え・破棄のときに一緒に片付ける（別のタブの書きかけと区別する）。
    const restoredDraftsRef = useRef(new Map<string, Map<string, string>>());

    // 非同期の処理から、いまの画面の状態を見るための写し。
    const stateRef = useRef(state);
    stateRef.current = state;

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
     * 保存層の内容を画面に出す。文書を画面に反映するのは、必ずここを通す
     * （開く・開き直す・他のタブや端末の変更の取り込み・拒否された操作の取り消し）。
     *
     * 読んでいる間にこちらで編集があったら、古い内容で上書きしないよう、読み直す。
     *
     * @param mode `open` は、まだ開いていなければ開く。`refresh` は、開いている画面の更新だけ。
     * @returns 保存層にノートが無かった（見えなかった）ら false。
     */
    const presentFromStore = async (
        targetId: string,
        mode: "open" | "refresh",
        isCancelled: () => boolean,
    ): Promise<boolean> => {
        const writes = writesOf(targetId);
        // 表示の状態（このブラウザだけの状態）は、最初に開くときにだけ使う。読めなくても開く。
        let view: StudyWorkspaceViewState | null = null;
        if (mode === "open") {
            try {
                const stored = await sync.getViewState(targetId);
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
            // 最新の内容を取り込めているかは、読む前に確かめる（取り込みが済んでいれば、これから
            // 読む内容はその結果を含む。読んだあとに確かめると、古い内容を最新と取り違えうる）。
            const fresh = sync.getPullState(targetId) !== "pending";
            await sync.whenLocalWritesSettled();
            let stored: StoredStudy | null;
            try {
                stored = await sync.load(targetId);
            } catch {
                return false;
            }
            if (isCancelled()) return true;
            // 読んでいる間に編集があった。いま読んだ内容は古いので、読み直す。
            if (writes.seq !== seq) continue;
            if (!stored || stored.deleting) return false;
            if (stored.mergedInto !== null) {
                void navigate({
                    to: "/studies/$studyId",
                    params: { studyId: stored.mergedInto },
                    replace: true,
                });
                return true;
            }
            const { doc, owner } = stored;
            setState((previous) => {
                if (previous.status === "ready" && previous.studyId === targetId) {
                    // 開いている画面の更新。表示の状態と書きかけは、画面が持っているものを使う。
                    return { ...previous, doc, ownerId: owner, locked: false, fresh };
                }
                if (mode === "refresh") return previous;
                // 前回、保存できないまま残っていたコメントは、その手のコメント欄に戻す。
                // 保存できる長さの下書き（ログインが切れて保存できなかった入力）があれば、その手を
                // 開く（開けば自動で保存される）。長すぎる下書きは、棋譜の印で知らせる。
                const drafts: StudyCommentDraft[] = readStudyCommentDrafts(targetId, owner);
                restoredDraftsRef.current.set(
                    targetId,
                    new Map(drafts.map((draft) => [draft.nodeId, draft.text])),
                );
                const resumable = [...drafts]
                    .reverse()
                    .find((draft) => fitsCommentLimit(draft.text));
                return {
                    status: "ready",
                    studyId: targetId,
                    doc,
                    view: resumable
                        ? {
                              selectedLayerId: view?.selectedLayerId ?? null,
                              currentNodeId: resumable.nodeId,
                          }
                        : view,
                    ownerId: owner,
                    locked: false,
                    drafts,
                    fresh,
                };
            });
            return true;
        }
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies: reloadCount は「もう一度読み込む」で開き直すための合図。presentFromStore は毎回作り直されるが、中身は ref と引数だけに依存する
    useEffect(() => {
        let cancelled = false;
        const isCancelled = (): boolean => cancelled;
        // 同じノートを開き直すだけのとき（ログイン状態が変わった、など）は、画面を作り直さない
        // （作り直すと、実行中の解析が止まり、書きかけのコメントも消えてしまう）。
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

        /**
         * 開いていたアカウントのノートが、ログインが切れて見えなくなったか。
         * その場合は「見つかりません」にせず、画面を残して編集を止める。
         */
        const lockIfWasOpen = (): boolean => {
            const current = stateRef.current;
            if (
                current.status !== "ready" ||
                current.studyId !== studyId ||
                current.ownerId === null ||
                // 別のアカウントでログインした場合は、前のアカウントのノートを画面に残さない。
                userId !== null
            ) {
                return false;
            }
            setState((previous) =>
                previous.status === "ready" && previous.studyId === studyId
                    ? { ...previous, locked: true }
                    : previous,
            );
            return true;
        };

        const unsubscribe = sync.subscribeEvents((event) => {
            if (cancelled) return;
            if (event.type === "unauthorized") {
                // セッションが切れた。ログイン状態を取り直すと、保存の案内が「ログインすると…」に変わる。
                dispatchAuthSessionSyncEvent();
                return;
            }
            if (event.studyId !== studyId) return;
            if (event.type === "pulled") {
                // サーバーの最新の内容を取り込めた。その内容を画面に出してから、コメントの下書きの
                // 保存を解く（`presentFromStore` が、最新かどうかも一緒に反映する）。
                void presentFromStore(studyId, "refresh", isCancelled);
                return;
            }
            if (event.type === "merged") {
                // 同じ元棋譜のノートが既にあった。成果はそのノートに統合済み。
                goTo(event.into);
            } else if (event.type === "removed") {
                // ノートが消えたら、その書きかけも残さない。
                removeStudyCommentDrafts(studyId);
                setState({ status: "removed" });
            } else if (event.origin !== "local") {
                // 他のタブ・他の端末の変更を取り込む。
                void presentFromStore(studyId, "refresh", isCancelled);
            }
        });

        void (async () => {
            if (sessionState !== "known") {
                // ログイン状態が分かる前に出してよいのは、匿名のノート（未ログイン中に作ったノート）だけ。
                // アカウントのノートは保存層が返さない（`load` が null）。その場合は「見つかりません」と
                // 決めつけず、ログイン状態が分かるまで読み込み中のままにする。
                const shown = await presentFromStore(studyId, "open", isCancelled);
                if (cancelled || shown) return;
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
            await ensureStudySession(userId, { confirmed: sessionConfirmed });
            const result = await sync.open(studyId);
            if (cancelled) return;
            if (result.status === "merged") {
                goTo(result.into);
                return;
            }
            // 開けたら、保存層の内容を画面に出す（`open` が返した文書は、待っている間の編集で
            // 古くなっていることがあるので、そのままは使わない）。
            if (result.status === "ok" && (await presentFromStore(studyId, "open", isCancelled))) {
                return;
            }
            if (cancelled || lockIfWasOpen()) return;
            setState(
                result.status === "unavailable"
                    ? { status: "unavailable", message: result.message }
                    : { status: "not_found" },
            );
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
        const current = stateRef.current;
        // 編集できない間（ログインが切れた）は、保存を試みない。書きかけは画面と下書きに残る。
        if (current.status === "ready" && current.studyId === targetId && current.locked) {
            return Promise.resolve(false);
        }
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
                void presentFromStore(targetId, "refresh", () => false);
                return false;
            },
        );
    };

    const goToLogin = (): void => {
        // OAuth でページが遷移するので、ブラウザ内への書き込みが終わってから進む。
        void sync
            .whenLocalWritesSettled()
            .catch(() => undefined)
            .then(() => {
                window.location.assign(loginHref(studyId));
            });
    };

    const isLocked = state.status === "ready" && state.locked;

    const handleLogin = (): void => {
        if (!isLocked) {
            goToLogin();
            return;
        }
        // ログインが切れて編集を止めている間の「ログインし直す」。別のタブでログインし直して
        // いることがあるので、まずセッションを確かめる。ログイン済みなら、ログインの画面へは
        // 送らず、ログイン状態を取り直す（同じ持ち主なら、その場で編集できるようになる）。
        void fetch("/api/auth/session", { credentials: "same-origin" })
            .then(async (response) => {
                if (!response.ok) return false;
                const payload: unknown = await response.json();
                return (
                    payload !== null &&
                    typeof payload === "object" &&
                    "authenticated" in payload &&
                    payload.authenticated === true
                );
            })
            .catch(() => false)
            .then((authenticated) => {
                if (authenticated) dispatchAuthSessionSyncEvent();
                else goToLogin();
            });
    };

    // 編集を止めている間にこのタブへ戻ってきたら、セッションを取り直す（別のタブでログイン
    // し直していれば、その場で編集できるようになる）。
    useEffect(() => {
        if (!isLocked) return;
        const recheck = (): void => {
            if (document.visibilityState === "visible") dispatchAuthSessionSyncEvent();
        };
        document.addEventListener("visibilitychange", recheck);
        window.addEventListener("focus", recheck);
        return () => {
            document.removeEventListener("visibilitychange", recheck);
            window.removeEventListener("focus", recheck);
        };
    }, [isLocked]);

    /**
     * 読み込めなかったあとの「もう一度読み込む」。ログイン状態の確認からやり直す
     * （確認そのものが失敗していた場合、ノートだけ読み直しても開けない）。
     */
    const handleReload = (): void => {
        void refreshSession();
        setReloadCount((count) => count + 1);
    };

    const handleDiscard = (): void => {
        void sync
            .deleteStudy(studyId)
            .then(() => {
                removeStudyCommentDrafts(studyId);
                return navigate({ to: "/studies" });
            })
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
                // 見出しの「ログイン」も、保存状態の案内と同じく、ログイン後にこのノートへ戻る。
                right={<HeaderNav login={{ href: loginHref(studyId), onNavigate: goToLogin }} />}
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
                        onClick={handleReload}
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
                        locked={state.locked}
                        commentBaseConfirmed={state.fresh}
                        initialCommentDrafts={state.drafts}
                        onCommentDraftChange={(nodeId, change) =>
                            applyStudyCommentDraftChange(studyId, state.ownerId, nodeId, change, {
                                restoredText:
                                    restoredDraftsRef.current.get(studyId)?.get(nodeId) ?? null,
                            })
                        }
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
