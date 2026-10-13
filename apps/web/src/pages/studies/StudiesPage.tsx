import type { StudyMeta, StudyOrigin } from "@shogi/app-core";
import {
    createSessionVerifier,
    createStudyApiClient,
    type StudyApi,
    type StudySaveStatus,
    type StudySession,
    type StudySummary,
} from "@shogi/study-client";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shogi/ui/components/alert-dialog";
import { StudyImportForm } from "@shogi/ui/components/study-workspace/StudyImportForm";
import type { StudyKifuSource } from "@shogi/ui/components/study-workspace/studyImport";
import {
    studyOriginLabel,
    studyPlayersLabel,
} from "@shogi/ui/components/study-workspace/studyView";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { AuthBadge } from "../../components/AuthBadge";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import { Section } from "../../components/Section";
import { StatusBanner } from "../../components/StatusBanner";
import { dispatchAuthSessionSyncEvent, useAuthSession } from "../../hooks/useAuthSession";
import { buildLoginHref } from "../../lib/loginReturn";
import { removeStudyCommentDrafts } from "../../lib/studyDrafts";
import { createStudyFromKifuSource } from "../../lib/studyEntry";
import { ensureStudySession, getStudySync } from "../../lib/studySync";

/** 一覧の 1 件。ブラウザ内のノートとクラウドのノートを、同じ形にして並べる。 */
interface StudyListItem {
    id: string;
    title: string;
    meta: StudyMeta;
    origin: StudyOrigin;
    /** 局面の数（開始局面を含む）。 */
    nodeCount: number;
    /** 解析が済んでいる局面の数（最も進んでいる解析の設定で）。 */
    resultCount: number;
    /** 最後に更新した時刻（Unix ミリ秒）。 */
    updatedAt: number;
    /** ブラウザ内にあるノートの保存の状態。クラウドにだけあるノートは null。 */
    status: StudySaveStatus | null;
}

const REMOTE_PAGE_SIZE = 50;

const fromRemote = (summary: StudySummary): StudyListItem => ({
    id: summary.id,
    title: summary.title,
    meta: summary.meta,
    origin: summary.origin,
    nodeCount: summary.nodeCount,
    resultCount: summary.resultCount,
    updatedAt: Date.parse(summary.updatedAt) || 0,
    status: null,
});

/** ブラウザ内とクラウドの一覧を 1 つにまとめる（同じノートはブラウザ内の内容を優先）。 */
export function mergeStudyLists(
    local: readonly StudyListItem[],
    remote: readonly StudyListItem[],
): StudyListItem[] {
    const byId = new Map<string, StudyListItem>();
    for (const item of remote) byId.set(item.id, item);
    for (const item of local) byId.set(item.id, item);
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function saveLabel(status: StudySaveStatus | null): { text: string; attention: boolean } {
    if (status === null) return { text: "クラウドに保存済み", attention: false };
    switch (status.state) {
        case "synced":
            return { text: "クラウドに保存済み", attention: false };
        case "pending":
            return { text: "クラウドへ保存中", attention: false };
        case "limit_exceeded":
            return { text: "クラウドの上限超過", attention: true };
        case "error":
            return {
                text: status.reason === "deleted_remotely" ? "他の端末で削除済み" : "保存に失敗",
                attention: true,
            };
        default:
            return { text: "このブラウザに保存", attention: false };
    }
}

function progressLabel(item: StudyListItem): string {
    if (item.resultCount <= 0) return "未解析";
    if (item.resultCount >= item.nodeCount) return "解析済み";
    return `解析 ${item.resultCount} / ${item.nodeCount} 局面`;
}

function ImportSection({
    onImport,
    isAuthenticated,
}: {
    onImport: (source: StudyKifuSource) => Promise<void>;
    isAuthenticated: boolean;
}): ReactElement {
    const linkClass =
        "inline-flex h-10 items-center gap-2 rounded-md border border-input px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return (
        <Section title="棋譜を取り込んで、研究ノートを作る">
            <p className="text-sm text-muted-foreground">
                棋譜を取り込んで全体を解析すると、見直すべき手が自動で並びます。解析結果・変化・コメントは自動で保存されます。
            </p>
            <StudyImportForm onImport={onImport} />
            <div className="flex flex-col gap-2 border-t border-border pt-3">
                <p className="text-sm text-muted-foreground">ほかの棋譜から作る</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Link to="/rshogi-viewer" className={linkClass}>
                        観戦・棋譜一覧から選ぶ
                    </Link>
                    <Link to="/games" className={linkClass}>
                        自分の対局から選ぶ
                        {!isAuthenticated && <AuthBadge />}
                    </Link>
                </div>
            </div>
        </Section>
    );
}

interface StudiesPageProps {
    /** クラウドの一覧の取得（テストで差し替える）。 */
    api?: StudyApi;
    /** サーバーから見た現在のログイン状態の確認（テストで差し替える）。 */
    verifySession?: () => Promise<StudySession | null>;
}

export default function StudiesPage({ api, verifySession }: StudiesPageProps): ReactElement {
    const navigate = useNavigate();
    const { session, isLoadingSession, sessionError } = useAuthSession();
    // 取り直しに失敗して前の値が残っているだけのときは、その値を同期エンジンへ伝え直さない。
    const sessionConfirmed = sessionError === null;
    // ログイン状態が確認できていない間（確認中・確認に失敗）は、匿名のノートだけを扱う。
    const sessionKnown = !isLoadingSession && session !== null;
    const userId = session?.authenticated ? session.user.id : null;
    const sync = getStudySync();
    const [client] = useState<StudyApi>(() => api ?? createStudyApiClient());
    // 同期エンジンが使うのと同じ確認（`GET /api/auth/session`）。
    const [verify] = useState(() => verifySession ?? createSessionVerifier());

    const [local, setLocal] = useState<StudyListItem[] | null>(null);
    const [remote, setRemote] = useState<StudyListItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [remoteError, setRemoteError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isImportOpen, setIsImportOpen] = useState(false);
    // 削除の確認中のノートと、そのノートを含む一覧を取得したときのユーザー。確認している間に
    // アカウントが変わっても、確定のときに「誰の一覧のノートか」を取り違えないよう、一緒に持つ。
    const [deleteTarget, setDeleteTarget] = useState<{
        item: StudyListItem;
        listOwnerId: string | null;
    } | null>(null);
    // クラウドの一覧（`remote`）を取得したときのユーザー。
    const remoteOwnerIdRef = useRef<string | null>(null);
    // いま表示している一覧の持ち主。アカウントが変わったら、前のアカウントの一覧と続きの位置を捨てる。
    const ownerKey = sessionKnown ? (userId ?? "signed-out") : "unknown";
    const ownerKeyRef = useRef(ownerKey);
    // 一覧の取得が 401 だったときに、ログイン状態の取り直しを頼んだユーザー。取り直しても
    // 同じユーザーのまま 401 が続くとき（サーバー側の障害など）に、取り直しを繰り返さないため。
    const listUnauthorizedForRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (ownerKeyRef.current !== ownerKey) {
            ownerKeyRef.current = ownerKey;
            setLocal(null);
            remoteOwnerIdRef.current = null;
            setRemote([]);
            setNextCursor(null);
            setRemoteError(null);
            setIsLoadingMore(false);
            // 前のアカウントの一覧のノートの削除を、いまのアカウントで確定させない。
            setDeleteTarget(null);
        }

        const loadLocal = async (): Promise<void> => {
            try {
                const summaries = await sync.listLocal();
                if (cancelled) return;
                setLocal(
                    summaries.map((summary) => ({
                        id: summary.id,
                        title: summary.title,
                        meta: summary.meta,
                        origin: summary.origin,
                        nodeCount: summary.nodeCount,
                        resultCount: summary.resultCount,
                        updatedAt: summary.updatedAt,
                        status: summary.status,
                    })),
                );
            } catch (failure) {
                if (cancelled) return;
                setLocal([]);
                setError(
                    `このブラウザに保存した研究ノートを読み込めませんでした: ${
                        failure instanceof Error ? failure.message : String(failure)
                    }`,
                );
            }
        };

        void (async () => {
            if (!sessionKnown) {
                // ログイン状態が分かる前でも、ブラウザ内のノートはすぐ出す。
                await loadLocal();
                return;
            }
            await ensureStudySession(userId, { confirmed: sessionConfirmed });
            await loadLocal();
            if (userId === null) {
                listUnauthorizedForRef.current = null;
                if (!cancelled) {
                    setRemote([]);
                    setNextCursor(null);
                }
                return;
            }
            const listed = await client.list({ limit: REMOTE_PAGE_SIZE });
            if (cancelled) return;
            if (listed.ok) {
                listUnauthorizedForRef.current = null;
                remoteOwnerIdRef.current = userId;
                setRemote(listed.data.studies.map(fromRemote));
                setNextCursor(listed.data.nextCursor);
                setRemoteError(null);
            } else if (listed.status === 401 && listUnauthorizedForRef.current !== userId) {
                // セッションが切れている。ログイン状態を取り直す（未ログインと分かれば、この画面は
                // ブラウザ内のノートだけを見せ、ログインを案内する）。この取得は同期エンジンを
                // 通らないので、ここで頼まないと、ヘッダーはログイン中のままクラウドのノートだけが
                // 黙って消える。
                listUnauthorizedForRef.current = userId;
                dispatchAuthSessionSyncEvent();
            } else {
                setRemoteError(
                    "クラウドに保存した研究ノートを読み込めませんでした。このブラウザにあるノートだけを表示しています。",
                );
            }
        })();

        // 削除・統合・他のタブでの変更を一覧に反映する。
        const unsubscribe = sync.subscribeEvents((event) => {
            if (event.type === "unauthorized") {
                // セッションが切れた・別のタブでアカウントが変わった。ログイン状態を取り直す
                // （取り直した結果で、一覧もそのアカウントのものに変わる）。
                dispatchAuthSessionSyncEvent();
                return;
            }
            if (event.type === "pulled") return;
            if (event.type === "removed") {
                setRemote((items) => items.filter((item) => item.id !== event.studyId));
            }
            void loadLocal();
        });
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [sessionKnown, userId, sessionConfirmed, ownerKey, sync, client]);

    const handleLoadMore = async (): Promise<void> => {
        if (isLoadingMore || nextCursor === null) return;
        const owner = ownerKeyRef.current;
        setIsLoadingMore(true);
        const listed = await client.list({ limit: REMOTE_PAGE_SIZE, cursor: nextCursor });
        // 読み込んでいる間にアカウントが変わっていたら、前のアカウントの続きは足さない。
        if (ownerKeyRef.current !== owner) return;
        if (listed.ok) {
            setRemote((items) => [...items, ...listed.data.studies.map(fromRemote)]);
            setNextCursor(listed.data.nextCursor);
        } else {
            // セッション切れなら、ログイン状態を取り直す（利用者の操作 1 回につき 1 回）。
            if (listed.status === 401) dispatchAuthSessionSyncEvent();
            setRemoteError("研究ノートの続きを読み込めませんでした。時間をおいてお試しください。");
        }
        setIsLoadingMore(false);
    };

    const handleImport = async (source: StudyKifuSource): Promise<void> => {
        if (sessionKnown) await ensureStudySession(userId, { confirmed: sessionConfirmed });
        const { studyId } = await createStudyFromKifuSource(source, { sync, api: client });
        await navigate({ to: "/studies/$studyId", params: { studyId } });
    };

    const handleDelete = async (): Promise<void> => {
        if (!deleteTarget) return;
        // `listOwnerId` は、一覧を取得したときのユーザー（クラウドのノートは、そのユーザーのもの）。
        // 確定した時点の画面のユーザーではない（確認している間に変わっていることがある）。
        const { item: target, listOwnerId } = deleteTarget;
        setDeleteTarget(null);
        setError(null);
        try {
            if (target.status === null) {
                // クラウドにだけあるノート。
                const deleted = await client.delete(target.id);
                if (!deleted.ok && deleted.status !== 404 && deleted.status !== 410) {
                    // セッション切れなら、ログイン状態を取り直す（削除できなかったことは下で伝える）。
                    if (deleted.status === 401) dispatchAuthSessionSyncEvent();
                    throw new Error(
                        deleted.error.message ?? `削除に失敗しました (${deleted.status})`,
                    );
                }
                if (!deleted.ok && deleted.status === 404) {
                    // 404 は「既に無い」だけでなく「いまのセッションのノートではない」でも返る。
                    // 別のタブでアカウントが切り替わっていたら、一覧の持ち主のノートはサーバーに
                    // 残っている。サーバーから見たログイン状態が、一覧を取得したときのユーザーの
                    // ままのときだけ、削除済みとして扱う（同期エンジンの削除と同じ確認）。
                    let verified: StudySession | null;
                    try {
                        verified = await verify();
                    } catch {
                        throw new Error(
                            "ログイン状態を確認できませんでした。時間をおいてお試しください。",
                        );
                    }
                    if (listOwnerId === null || verified?.userId !== listOwnerId) {
                        dispatchAuthSessionSyncEvent();
                        throw new Error(
                            "ログイン状態が変わっています。ログインし直してからお試しください。",
                        );
                    }
                }
                setRemote((items) => items.filter((item) => item.id !== target.id));
                removeStudyCommentDrafts(target.id);
            } else {
                // ブラウザ内から消す。クラウドにもあるノートは、同期エンジンがクラウドからも消す。
                await sync.deleteStudy(target.id);
                setRemote((items) => items.filter((item) => item.id !== target.id));
                removeStudyCommentDrafts(target.id);
            }
        } catch (failure) {
            setError(
                `研究ノートを削除できませんでした: ${
                    failure instanceof Error ? failure.message : String(failure)
                }`,
            );
        }
    };

    const isLoading = local === null;
    const items = mergeStudyLists(local ?? [], remote);
    const isAuthenticated = userId !== null;

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "研究ノート" }]}
                right={<HeaderNav />}
            />
            <PageContainer>
                <PageHeading
                    // 「（整備中）」は、研究ノートの本格実装が済んだら外す。
                    title="研究ノート（整備中）"
                    description="棋譜を AI で解析して、悪手の見直しや変化の研究を残しておけます。"
                >
                    {!isLoading && !isAuthenticated && items.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            いまはこのブラウザの中にだけ保存されています。
                            <a
                                href={buildLoginHref("/studies")}
                                className="text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light"
                            >
                                ログインするとクラウドにも保存できます
                            </a>
                        </p>
                    )}
                </PageHeading>

                {error && <StatusBanner variant="error">{error}</StatusBanner>}
                {remoteError && <StatusBanner variant="error">{remoteError}</StatusBanner>}

                {isLoading && (
                    <p aria-live="polite" className="text-sm text-muted-foreground">
                        読み込み中...
                    </p>
                )}

                {!isLoading && items.length === 0 && (
                    <ImportSection onImport={handleImport} isAuthenticated={isAuthenticated} />
                )}

                {!isLoading && items.length > 0 && (
                    <>
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-muted-foreground">{items.length} 件</p>
                            <button
                                type="button"
                                aria-expanded={isImportOpen}
                                onClick={() => setIsImportOpen(!isImportOpen)}
                                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                                棋譜を取り込む
                            </button>
                        </div>
                        {isImportOpen && (
                            <ImportSection
                                onImport={handleImport}
                                isAuthenticated={isAuthenticated}
                            />
                        )}
                        <ul className="grid gap-3">
                            {items.map((item) => {
                                const players = studyPlayersLabel(item.meta);
                                const save = saveLabel(item.status);
                                return (
                                    <li
                                        key={item.id}
                                        className="flex items-stretch gap-2 rounded-xl border border-border bg-card pr-2 shadow-sm transition-colors hover:bg-muted/20"
                                    >
                                        <Link
                                            to="/studies/$studyId"
                                            params={{ studyId: item.id }}
                                            className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            <h2 className="truncate text-base font-semibold text-foreground">
                                                {item.title}
                                            </h2>
                                            {players && (
                                                <p className="truncate text-sm text-muted-foreground">
                                                    {players}
                                                </p>
                                            )}
                                            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                <span>{studyOriginLabel(item.origin)}</span>
                                                <span>{progressLabel(item)}</span>
                                                <span>
                                                    更新{" "}
                                                    {new Date(item.updatedAt).toLocaleString(
                                                        "ja-JP",
                                                    )}
                                                </span>
                                                <span
                                                    className={
                                                        save.attention
                                                            ? "text-destructive"
                                                            : undefined
                                                    }
                                                >
                                                    {save.text}
                                                </span>
                                            </p>
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setDeleteTarget({
                                                    item,
                                                    listOwnerId: remoteOwnerIdRef.current,
                                                })
                                            }
                                            aria-label={`「${item.title}」を削除`}
                                            className="min-h-10 shrink-0 self-center rounded-md px-3 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            削除
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        {nextCursor !== null && (
                            <div className="flex justify-center">
                                <button
                                    type="button"
                                    onClick={() => void handleLoadMore()}
                                    disabled={isLoadingMore}
                                    className="rounded-md border border-input px-6 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                                >
                                    {isLoadingMore ? "読み込み中..." : "もっと見る"}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </PageContainer>

            <AlertDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>研究ノートを削除しますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                            「{deleteTarget?.item.title}
                            」の解析結果・変化・コメントをすべて削除します。元に戻せません。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>やめる</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleDelete()}>
                            削除する
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
