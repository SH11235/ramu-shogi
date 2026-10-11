import { applyStudyOps, type StudyDocument, type StudyOp } from "@shogi/app-core";
import type { EngineOption, StudyWorkspaceViewState } from "@shogi/ui";
import { StudyWorkspace } from "@shogi/ui";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { Section } from "../../components/Section";
import { StatusBanner } from "../../components/StatusBanner";
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

/** 上限の名前（保存層・サーバーが返す `limit`）ごとの、その場で分かる文言。 */
const LIMIT_MESSAGE: Record<string, string> = {
    commentBytes: "コメントが長すぎます。短くしてください。",
    nodesPerStudy: "このノートの局面の数が上限に達しました。",
    lineLength: "このノートの手数が上限に達しました。",
    layersPerStudy: "解析の設定が多すぎます（1 つのノートに 8 種類まで）。",
    titleLength: "表題が長すぎます。",
    treeBytes: "棋譜と変化が大きすぎます。",
    layerResultsBytes: "解析結果が大きすぎます。",
};

/** 変更を保存できなかった理由を、利用者向けの文言にする。 */
function describeOpError(error: unknown): string {
    const limit =
        error !== null && typeof error === "object" && "limit" in error
            ? (error as { limit?: unknown }).limit
            : undefined;
    if (typeof limit === "string" && Object.hasOwn(LIMIT_MESSAGE, limit)) {
        return `変更を保存できませんでした: ${LIMIT_MESSAGE[limit]}`;
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
    // セッションの取得に失敗したとき（backend に届かない、など）は未ログインとして扱う。
    const sessionKnown = !isLoadingSession;
    const userId = session?.authenticated ? session.user.id : null;
    const sync = getStudySync();
    const [state, setState] = useState<LoadState>({ status: "loading" });
    const [reloadCount, setReloadCount] = useState(0);
    const [opError, setOpError] = useState<string | null>(null);
    const saveStatus = useSyncExternalStore(
        (listener) => sync.subscribeStatus(studyId, listener),
        () => sync.getStatus(studyId),
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: reloadCount は「もう一度読み込む」で開き直すための合図
    useEffect(() => {
        let cancelled = false;
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
        const reload = async (): Promise<void> => {
            // こちらの書き込みが終わってから読む（書きかけの変更を古い内容で上書きしないように）。
            await sync.whenLocalWritesSettled();
            const stored = await sync.load(studyId);
            if (cancelled || !stored) return;
            if (stored.mergedInto !== null) {
                goTo(stored.mergedInto);
                return;
            }
            setState((previous) =>
                previous.status === "ready" && previous.studyId === studyId
                    ? { ...previous, doc: stored.doc }
                    : previous,
            );
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
                void reload().catch(() => undefined);
            }
        });

        void (async () => {
            if (!sessionKnown) {
                // ログイン状態が分かる前でも、ブラウザ内にあるノートはすぐ開く
                //（クラウドにしか無いノートは、ログイン状態が分かってから取りに行く）。
                const stored = await sync.load(studyId);
                if (cancelled || !stored || stored.deleting) return;
                if (stored.mergedInto !== null) {
                    goTo(stored.mergedInto);
                    return;
                }
                const view = await loadView();
                if (cancelled) return;
                setState((previous) =>
                    previous.status === "ready" && previous.studyId === studyId
                        ? previous
                        : { status: "ready", studyId, doc: stored.doc, view },
                );
                return;
            }
            // ログイン状態を伝え、未ログイン中に作ったノートをアカウントへ引き継いでから開く。
            await ensureStudySession(userId);
            // 開き直すときに、書きかけの変更を古い内容で上書きしないよう、書き込みが終わるのを待つ。
            await sync.whenLocalWritesSettled();
            const result = await sync.open(studyId);
            if (cancelled) return;
            if (result.status === "ok") {
                const view = await loadView();
                if (cancelled) return;
                // 開き直しでは、画面が持っている表示の状態をそのまま使う。
                setState((previous) => ({
                    status: "ready",
                    studyId,
                    doc: result.study.doc,
                    view:
                        previous.status === "ready" && previous.studyId === studyId
                            ? previous.view
                            : view,
                }));
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
    }, [studyId, sessionKnown, userId, sync, navigate, reloadCount]);

    const handleApplyOps = (ops: StudyOp[]): void => {
        // 画面にはすぐ反映し、保存層（ブラウザ内 → クラウド）へ流す。
        setState((previous) => {
            if (previous.status !== "ready") return previous;
            try {
                return { ...previous, doc: applyStudyOps(previous.doc, ops) };
            } catch (error) {
                console.error("[study] 操作を適用できませんでした", error);
                return previous;
            }
        });
        setOpError(null);
        void sync.applyOps(studyId, ops).catch(async (error: unknown) => {
            // 保存層が受け付けなかった（上限を超えた・形が正しくない、など）か、ブラウザへの書き込みに
            // 失敗した。その場で理由を出し、画面を保存されている内容に戻す。
            console.error("[study] 変更を保存できませんでした", error);
            setOpError(describeOpError(error));
            const stored = await sync.load(studyId).catch(() => null);
            if (stored) {
                setState((previous) =>
                    previous.status === "ready" && previous.studyId === studyId
                        ? { ...previous, doc: stored.doc }
                        : previous,
                );
            }
        });
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
            {opError && state.status === "ready" && (
                <div className="mx-auto w-full max-w-[1320px] px-3 pt-3 md:px-4">
                    <StatusBanner variant="error">{opError}</StatusBanner>
                </div>
            )}
            {state.status === "ready" && state.studyId === studyId && (
                <StudyWorkspace
                    key={studyId}
                    doc={state.doc}
                    onApplyOps={handleApplyOps}
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
                    engineOptions={engineOptions}
                    manifestUrl={import.meta.env.VITE_NNUE_MANIFEST_URL as string}
                    defaultNnuePresetKey={import.meta.env.VITE_DEFAULT_NNUE_PRESET}
                    engine={builtinEngine}
                />
            )}
        </>
    );
}
