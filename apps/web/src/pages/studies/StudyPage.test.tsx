import type { StudyOp } from "@shogi/app-core";
import {
    createMemoryStudyStore,
    createStudySync,
    type StoredStudy,
    type StudySync,
    type StudySyncEvent,
} from "@shogi/study-client";
import type { StudyWorkspaceProps } from "@shogi/ui";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    AUTH_LOADING,
    AUTH_SIGNED_OUT,
    authSignedIn,
    createOfflineApi,
    createTestDoc,
    createTestSync,
    type TestAuthState,
} from "./studies-test-support";

const STUDY_ID = "11111111-1111-4111-8111-111111111111";
const DRAFTS_KEY = "ramu-study-comment-drafts";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const navigate = vi.fn(async () => {});
let currentSync: StudySync;
let currentStudyId = STUDY_ID;
let auth: TestAuthState = AUTH_SIGNED_OUT;
let workspaceProps: StudyWorkspaceProps | null = null;

vi.mock("@tanstack/react-router", () => ({
    getRouteApi: () => ({ useParams: () => ({ studyId: currentStudyId }) }),
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
    useNavigate: () => navigate,
}));
const refreshSession = vi.fn(async () => {});
let headerLogin: { href: string; onNavigate: () => void } | undefined;

const dispatchAuthSessionSyncEvent = vi.fn();
vi.mock("../../hooks/useAuthSession", () => ({
    useAuthSession: () => ({ sessionError: null, ...auth, refreshSession }),
    dispatchAuthSessionSyncEvent: () => dispatchAuthSessionSyncEvent(),
}));
vi.mock("../../components/HeaderNav", () => ({
    HeaderNav: (props: { login?: { href: string; onNavigate: () => void } }) => {
        headerLogin = props.login;
        return null;
    },
}));
vi.mock("../../components/PageHeader", () => ({
    PageHeader: ({ right }: { right?: ReactNode }) => <>{right}</>,
}));
vi.mock("../../platform/wasm-engine-client", () => ({ createWebWasmEngineClient: vi.fn() }));
// `lib/studySync`（セッションの伝達・引き継ぎ）は本物を使い、その下の同期エンジンだけを差し替える。
vi.mock("@shogi/study-client", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@shogi/study-client")>()),
    createBrowserStudySync: () => ({ sync: currentSync, store: null, dispose: () => {} }),
}));
// 画面そのものは `@shogi/ui` 側でテストしている。ここではページが渡すものを確かめる。
vi.mock("@shogi/ui", () => ({
    StudyWorkspace: (props: StudyWorkspaceProps) => {
        workspaceProps = props;
        return (
            <div data-testid="workspace">
                {props.doc.title}/{props.saveStatus.state}/{props.saveStatus.reason}
            </div>
        );
    },
}));

/** コメント欄が知らせる「下書きを置く」（コメントが空のときに書き始めた入力）。 */
const setDraft = (text: string) => ({ type: "set" as const, text, base: "" });
/** コメント欄が知らせる「保存できたので消す」。 */
const clearDraft = (savedText: string | null) => ({ type: "clear" as const, savedText });

const { resetStudySyncForTest } = await import("../../lib/studySync");
const { default: StudyPage } = await import("./StudyPage");

const workspaceText = (): string => screen.getByTestId("workspace").textContent ?? "";

/** アカウント（user-1）のノートが保存層にあり、ログイン状態はまだ伝わっていない同期エンジンを用意する。 */
const prepareOwnedStudy = async (title: string): Promise<void> => {
    const store = createMemoryStudyStore();
    const seed = createTestSync(createOfflineApi(), store);
    seed.setSession({ userId: "user-1" });
    await seed.createStudy(createTestDoc(STUDY_ID, title));
    seed.dispose();
    currentSync = createTestSync(createOfflineApi(), store);
};

describe("StudyPage", () => {
    beforeEach(() => {
        navigate.mockClear();
        refreshSession.mockClear();
        dispatchAuthSessionSyncEvent.mockClear();
        headerLogin = undefined;
        workspaceProps = null;
        currentStudyId = STUDY_ID;
        auth = AUTH_SIGNED_OUT;
        localStorage.clear();
        resetStudySyncForTest();
        currentSync = createTestSync();
    });

    it("ブラウザ内のノートを開き、未ログインなら「ブラウザ内・匿名」として渡す", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "開くノート"));
        render(<StudyPage />);

        expect((await screen.findByTestId("workspace")).textContent).toBe(
            "開くノート/local/anonymous",
        );
        expect(workspaceProps?.engine).toMatchObject({ kind: "wasm", name: "rshogi" });
    });

    describe("ログイン状態が分かる前", () => {
        it("匿名のノート（未ログイン中に作ったノート）は、確認を待たずに開く", async () => {
            await currentSync.createStudy(createTestDoc(STUDY_ID, "匿名のノート"));
            auth = AUTH_LOADING;
            render(<StudyPage />);

            expect((await screen.findByTestId("workspace")).textContent).toContain("匿名のノート");
            expect(currentSync.getSessionStatus()).toBe("unknown");
        });

        it("アカウントのノートは表示せず、「見つかりません」とも出さずに待ち、確定してから開く", async () => {
            await prepareOwnedStudy("アカウントのノート");
            auth = AUTH_LOADING;
            const view = render(<StudyPage />);

            // 確認中: 読み込み中のまま（私有のノートを先に出さない。無いとも言わない）。
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
            });
            expect(screen.getByText("研究ノートを読み込み中...")).toBeTruthy();
            expect(screen.queryByTestId("workspace")).toBeNull();
            expect(screen.queryByText("研究ノートが見つかりません")).toBeNull();

            auth = authSignedIn("user-1");
            view.rerender(<StudyPage />);

            expect((await screen.findByTestId("workspace")).textContent).toContain(
                "アカウントのノート",
            );
        });

        it("確認の結果が別のアカウント・未ログインなら、アカウントのノートは開かない", async () => {
            await prepareOwnedStudy("アカウントのノート");
            auth = AUTH_LOADING;
            const view = render(<StudyPage />);
            auth = AUTH_SIGNED_OUT;
            view.rerender(<StudyPage />);

            expect(
                await screen.findByRole("heading", { name: "研究ノートが見つかりません" }),
            ).toBeTruthy();
            expect(screen.queryByTestId("workspace")).toBeNull();
        });
    });

    describe("開いている間にログインが切れたとき", () => {
        it("「見つかりません」にせず、画面を残して編集を止め、書きかけのコメントを持ち主つきで残す", async () => {
            await prepareOwnedStudy("アカウントのノート");
            auth = authSignedIn("user-1");
            const view = render(<StudyPage />);
            await screen.findByTestId("workspace");
            expect(workspaceProps?.locked).toBe(false);
            const nodeId = workspaceProps?.doc.tree.rootId ?? "";

            // コメントを書いている途中（自動保存の前）にログインが切れる。
            workspaceProps?.onCommentDraftChange?.(nodeId, setDraft("書きかけのコメント"));
            auth = AUTH_SIGNED_OUT;
            view.rerender(<StudyPage />);

            await waitFor(() => expect(workspaceProps?.locked).toBe(true));
            expect(screen.getByTestId("workspace")).toBeTruthy();
            expect(screen.queryByText("研究ノートが見つかりません")).toBeNull();
            // 編集できない間の操作は保存を試みず、エラーの通知も出さない。
            expect(
                await workspaceProps?.onApplyOps([
                    { type: "setComment", nodeId, value: "書きかけのコメント" },
                ]),
            ).toBe(false);
            expect(workspaceProps?.notice ?? null).toBeNull();
            // 下書きは、ノートの持ち主と一緒に残っている。
            expect(JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}")[STUDY_ID]).toMatchObject({
                ownerId: "user-1",
                nodes: [{ nodeId, text: "書きかけのコメント", base: "" }],
            });

            // 同じアカウントでログインし直すと、そのまま編集できるようになる。
            auth = authSignedIn("user-1");
            view.rerender(<StudyPage />);
            await waitFor(() => expect(workspaceProps?.locked).toBe(false));
            expect(
                await workspaceProps?.onApplyOps([
                    { type: "setComment", nodeId, value: "書きかけのコメント" },
                ]),
            ).toBe(true);
            // 保存できたら、下書きは消える。
            // 別の内容の保存の完了（古いコメント欄からの通知）では、消さない。
            workspaceProps?.onCommentDraftChange?.(nodeId, clearDraft("別の内容"));
            expect(JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}")[STUDY_ID]).toBeDefined();
            workspaceProps?.onCommentDraftChange?.(nodeId, clearDraft("書きかけのコメント"));
            expect(JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}")[STUDY_ID]).toBeUndefined();
        });

        /** アカウントのノートを開いたあと、ログインが切れて編集が止まった状態にする。 */
        const openThenLock = async () => {
            await prepareOwnedStudy("アカウントのノート");
            auth = authSignedIn("user-1");
            const view = render(<StudyPage />);
            await screen.findByTestId("workspace");
            auth = AUTH_SIGNED_OUT;
            view.rerender(<StudyPage />);
            await waitFor(() => expect(workspaceProps?.locked).toBe(true));
            dispatchAuthSessionSyncEvent.mockClear();
            return view;
        };
        const stubSession = (authenticated: boolean) => {
            const assign = vi.fn();
            vi.stubGlobal("location", { ...window.location, assign });
            const fetchMock = vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    authenticated,
                    user: authenticated ? { id: "user-1" } : null,
                }),
            }));
            vi.stubGlobal("fetch", fetchMock);
            return { assign, fetchMock };
        };

        it("セッション切れ（401）のあと、ログイン状態の取り直しに失敗しても、古いユーザーで送信を再開しない", async () => {
            const store = createMemoryStudyStore();
            const seed = createTestSync(createOfflineApi(), store);
            seed.setSession({ userId: "user-1" });
            await seed.createStudy(createTestDoc(STUDY_ID, "アカウントのノート"));
            seed.dispose();
            const unauthorized = async () => ({ ok: false as const, status: 401, error: {} });
            const api = createOfflineApi({ create: vi.fn(unauthorized) });
            currentSync = createTestSync(api, store);
            auth = authSignedIn("user-1");
            const view = render(<StudyPage />);
            await screen.findByTestId("workspace");
            // サーバーが 401 を返した。同期エンジンは送信を止め、画面はログイン状態を取り直す。
            await waitFor(() => expect(dispatchAuthSessionSyncEvent).toHaveBeenCalledTimes(1));
            expect(currentSync.getStatus(STUDY_ID).reason).toBe("signed_out");

            // 取り直しが通信エラーで失敗した（前の値が残り、エラーが立つ）。
            auth = { ...authSignedIn("user-1"), isLoadingSession: true };
            view.rerender(<StudyPage />);
            auth = { ...authSignedIn("user-1"), sessionError: "Failed to fetch" };
            view.rerender(<StudyPage />);
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
            });
            expect(currentSync.getStatus(STUDY_ID).reason).toBe("signed_out");
            expect(api.create).toHaveBeenCalledTimes(1);

            // 取り直せて、同じユーザーでログイン済みと分かれば、送信を再開する。
            auth = { ...authSignedIn("user-1"), isLoadingSession: true };
            view.rerender(<StudyPage />);
            auth = authSignedIn("user-1");
            view.rerender(<StudyPage />);
            await waitFor(() =>
                expect(currentSync.getStatus(STUDY_ID).reason).not.toBe("signed_out"),
            );
        });

        /** アカウントのノートを開き、サーバーが 1 度だけ 401 を返した（同期エンジンが送信を止めた）状態にする。 */
        const openThenUnauthorized = async () => {
            const store = createMemoryStudyStore();
            const seed = createTestSync(createOfflineApi(), store);
            seed.setSession({ userId: "user-1" });
            await seed.createStudy(createTestDoc(STUDY_ID, "アカウントのノート"));
            seed.dispose();
            const create = vi.fn(createOfflineApi().create).mockImplementationOnce(async () => ({
                ok: false as const,
                status: 401,
                error: {},
            }));
            currentSync = createTestSync(createOfflineApi({ create }), store);
            auth = authSignedIn("user-1");
            const view = render(<StudyPage />);
            await screen.findByTestId("workspace");
            await waitFor(() => expect(dispatchAuthSessionSyncEvent).toHaveBeenCalledTimes(1));
            return view;
        };

        it("セッション切れ（401）のあと、ログイン状態の取り直しに失敗している間は、編集を止めたままにする", async () => {
            const view = await openThenUnauthorized();
            const nodeId = workspaceProps?.doc.tree.rootId ?? "";
            const edit: StudyOp[] = [{ type: "setComment", nodeId, value: "送れない編集" }];

            // 401 を受けたら、取り直しの結果を待たずに編集を止める（画面は残す）。
            await waitFor(() => expect(workspaceProps?.locked).toBe(true));
            workspaceProps?.onCommentDraftChange?.(nodeId, setDraft("送れない編集"));

            // 取り直しが通信エラーで失敗した（認証の状態には前のユーザーが残る）。
            auth = { ...authSignedIn("user-1"), isLoadingSession: true };
            view.rerender(<StudyPage />);
            auth = { ...authSignedIn("user-1"), sessionError: "Failed to fetch" };
            view.rerender(<StudyPage />);
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
            });
            expect(screen.getByTestId("workspace")).toBeTruthy();
            expect(workspaceProps?.locked).toBe(true);
            // ノートは読めるが、編集は保存層に書かない（送れない編集を積み上げない）。
            expect(await workspaceProps?.onApplyOps(edit)).toBe(false);
            expect(workspaceProps?.notice ?? null).toBeNull();
            expect((await currentSync.load(STUDY_ID))?.doc.tree.nodes[nodeId].comment ?? "").toBe(
                "",
            );
            // 他のタブの変更を取り込み直しても、解かない。
            await act(async () => {
                await workspaceProps?.onApplyOps(edit);
                await new Promise((resolve) => setTimeout(resolve, 10));
            });
            expect(workspaceProps?.locked).toBe(true);
            // 書きかけは、持ち主と一緒に残っている。
            expect(JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}")[STUDY_ID]).toMatchObject({
                ownerId: "user-1",
                nodes: [{ nodeId, text: "送れない編集" }],
            });

            // 取り直せて、同じユーザーでログイン済みと分かったら、その場で編集できるようになる。
            auth = { ...authSignedIn("user-1"), isLoadingSession: true };
            view.rerender(<StudyPage />);
            auth = authSignedIn("user-1");
            view.rerender(<StudyPage />);
            await waitFor(() => expect(workspaceProps?.locked).toBe(false));
            expect(await workspaceProps?.onApplyOps(edit)).toBe(true);
        });

        it("セッション切れ（401）のまま、取り直しに失敗した状態でノートを開いても、編集を止めて開く", async () => {
            const view = await openThenUnauthorized();
            view.unmount();
            workspaceProps = null;

            // 取り直しに失敗したまま（前のユーザーが残っている）、ノートを開き直す。
            auth = { ...authSignedIn("user-1"), sessionError: "Failed to fetch" };
            render(<StudyPage />);
            await screen.findByTestId("workspace");

            expect((workspaceProps as StudyWorkspaceProps | null)?.locked).toBe(true);
        });

        it("401 を受けていなければ、ログイン状態の取り直しに失敗しただけ（オフライン）では編集を止めない", async () => {
            await prepareOwnedStudy("アカウントのノート");
            auth = authSignedIn("user-1");
            const view = render(<StudyPage />);
            await screen.findByTestId("workspace");
            const nodeId = workspaceProps?.doc.tree.rootId ?? "";

            auth = { ...authSignedIn("user-1"), isLoadingSession: true };
            view.rerender(<StudyPage />);
            auth = { ...authSignedIn("user-1"), sessionError: "Failed to fetch" };
            view.rerender(<StudyPage />);
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
            });

            expect(workspaceProps?.locked).toBe(false);
            expect(
                await workspaceProps?.onApplyOps([
                    { type: "setComment", nodeId, value: "オフラインの編集" },
                ]),
            ).toBe(true);
        });

        it("別のタブでアカウントが切り替わったと分かったあと、取り直しに失敗しても、「見つかりません」にせず編集を止める", async () => {
            const store = createMemoryStudyStore();
            const seed = createTestSync(createOfflineApi(), store);
            seed.setSession({ userId: "user-1" });
            await seed.createStudy(createTestDoc(STUDY_ID, "アカウントのノート"));
            seed.dispose();
            // 作成の直前の確認で、サーバーから見たログイン状態が別のユーザーだった。
            currentSync = createStudySync({
                store,
                api: createOfflineApi(),
                verifySession: async () => ({ userId: "user-2" }),
            });
            auth = authSignedIn("user-1");
            const view = render(<StudyPage />);
            await screen.findByTestId("workspace");
            await waitFor(() => expect(dispatchAuthSessionSyncEvent).toHaveBeenCalled());
            await waitFor(() => expect(workspaceProps?.locked).toBe(true));

            // 取り直しが通信エラーで失敗した（認証の状態には前のユーザーが残る）。
            auth = { ...authSignedIn("user-1"), isLoadingSession: true };
            view.rerender(<StudyPage />);
            auth = { ...authSignedIn("user-1"), sessionError: "Failed to fetch" };
            view.rerender(<StudyPage />);
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
            });

            expect(screen.getByTestId("workspace")).toBeTruthy();
            expect(screen.queryByText("研究ノートが見つかりません")).toBeNull();
            expect(workspaceProps?.locked).toBe(true);
        });

        it("別のタブでログインし直してからこのタブに戻ると、セッションを取り直し、その場で編集できるようになる", async () => {
            const view = await openThenLock();

            // このタブに戻ってきた。
            window.dispatchEvent(new Event("focus"));
            expect(dispatchAuthSessionSyncEvent).toHaveBeenCalledTimes(1);

            // 取り直した結果、同じ持ち主でログイン済みだった。
            auth = authSignedIn("user-1");
            view.rerender(<StudyPage />);
            await waitFor(() => expect(workspaceProps?.locked).toBe(false));
            // 編集できるようになったら、タブに戻るたびの確認はやめる。
            dispatchAuthSessionSyncEvent.mockClear();
            window.dispatchEvent(new Event("focus"));
            expect(dispatchAuthSessionSyncEvent).not.toHaveBeenCalled();
        });

        it("ログイン済みなのに「ログインし直す」を押しても、ログインの画面へは送らず、セッションを取り直す", async () => {
            await openThenLock();
            const { assign, fetchMock } = stubSession(true);

            workspaceProps?.onLogin?.();

            await waitFor(() => expect(dispatchAuthSessionSyncEvent).toHaveBeenCalledTimes(1));
            expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", expect.anything());
            expect(assign).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it("ログインしていなければ、「ログインし直す」で（戻り先つきの）ログインへ進む", async () => {
            await openThenLock();
            const { assign } = stubSession(false);

            workspaceProps?.onLogin?.();

            await waitFor(() =>
                expect(assign).toHaveBeenCalledWith(`/auth?next=%2Fstudies%2F${STUDY_ID}`),
            );
            expect(dispatchAuthSessionSyncEvent).not.toHaveBeenCalled();
            vi.unstubAllGlobals();
        });

        it("ログインし直して戻ってくると（ページを開き直しても）、下書きがその手のコメント欄に戻る", async () => {
            await prepareOwnedStudy("アカウントのノート");
            auth = authSignedIn("user-1");
            const first = render(<StudyPage />);
            await screen.findByTestId("workspace");
            const doc = workspaceProps?.doc;
            const nodeId = Object.keys(doc?.tree.nodes ?? {}).find((id) => id !== doc?.tree.rootId);
            expect(nodeId).toBeTruthy();
            workspaceProps?.onCommentDraftChange?.(nodeId ?? "", setDraft("戻ってくる下書き"));
            auth = AUTH_SIGNED_OUT;
            first.rerender(<StudyPage />);
            await waitFor(() => expect(workspaceProps?.locked).toBe(true));
            // ログインのためにページを離れる（OAuth でページが遷移する）。
            first.unmount();
            workspaceProps = null;

            auth = authSignedIn("user-1");
            render(<StudyPage />);
            await screen.findByTestId("workspace");

            const reopened = workspaceProps as StudyWorkspaceProps | null;
            // 書き始めたときのコメント（空）も一緒に戻す（変わっていたら、画面が利用者に選ばせる）。
            expect(reopened?.initialCommentDrafts).toEqual([
                { nodeId, text: "戻ってくる下書き", base: "" },
            ]);
            // 下書きのある手を開く。
            expect(reopened?.initialView?.currentNodeId).toBe(nodeId);
        });

        it("別のアカウントでログインした場合は、ノートも下書きも出さない", async () => {
            await prepareOwnedStudy("アカウントのノート");
            auth = authSignedIn("user-1");
            const view = render(<StudyPage />);
            await screen.findByTestId("workspace");
            const nodeId = workspaceProps?.doc.tree.rootId ?? "";
            workspaceProps?.onCommentDraftChange?.(nodeId, setDraft("user-1 の下書き"));

            auth = authSignedIn("user-2");
            view.rerender(<StudyPage />);

            expect(
                await screen.findByRole("heading", { name: "研究ノートが見つかりません" }),
            ).toBeTruthy();
            expect(screen.queryByTestId("workspace")).toBeNull();
            // user-1 の下書きは消さずに残す（user-1 が戻ってきたときのため）。
            expect(JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}")[STUDY_ID]).toMatchObject({
                ownerId: "user-1",
            });
        });

        it("別の持ち主の下書きは、同じ ID のノートを開いても戻さない", async () => {
            // user-1 の下書きが残っているブラウザで、匿名のノート（持ち主なし）を同じ ID で開く。
            localStorage.setItem(
                DRAFTS_KEY,
                JSON.stringify({
                    [STUDY_ID]: { ownerId: "user-1", nodeId: "node", text: "他人の下書き", at: 1 },
                }),
            );
            await currentSync.createStudy(createTestDoc(STUDY_ID, "匿名のノート"));
            render(<StudyPage />);
            await screen.findByTestId("workspace");

            expect(workspaceProps?.initialCommentDrafts ?? []).toEqual([]);
        });
    });

    it("長すぎて保存できないコメントは、手ごとに下書きとして残り、開き直すとその手に戻る", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "匿名のノート"));
        const first = render(<StudyPage />);
        await screen.findByTestId("workspace");
        const doc = workspaceProps?.doc;
        const [nodeA, nodeB] = Object.keys(doc?.tree.nodes ?? {}).filter(
            (id) => id !== doc?.tree.rootId,
        );
        const tooLong = "あ".repeat(2000);

        // 手 A に長すぎるコメントを書いたまま、手 B でコメントを書いて保存する。
        workspaceProps?.onCommentDraftChange?.(nodeA, setDraft(tooLong));
        workspaceProps?.onCommentDraftChange?.(nodeB, setDraft("保存できるコメント"));
        workspaceProps?.onCommentDraftChange?.(nodeB, clearDraft("保存できるコメント"));

        // 手 B を保存しても、手 A の下書きは消えない。
        expect(JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}")[STUDY_ID].nodes).toMatchObject([
            { nodeId: nodeA, text: tooLong, base: "" },
        ]);

        first.unmount();
        workspaceProps = null;
        render(<StudyPage />);
        await screen.findByTestId("workspace");
        const reopened = workspaceProps as StudyWorkspaceProps | null;
        expect(reopened?.initialCommentDrafts).toEqual([
            { nodeId: nodeA, text: tooLong, base: "" },
        ]);
        // 長すぎる下書きのために、開く局面は変えない（棋譜の印で知らせる）。
        expect(reopened?.initialView?.currentNodeId ?? null).toBeNull();
    });

    it("匿名のノートに残した下書きは、ログインして（ページを開き直して）ノートを引き継いだあとも、その手に戻る", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "匿名のノート"));
        const first = render(<StudyPage />);
        await screen.findByTestId("workspace");
        const doc = workspaceProps?.doc;
        const nodeId = Object.keys(doc?.tree.nodes ?? {}).find((id) => id !== doc?.tree.rootId);
        const tooLong = "あ".repeat(2000);
        workspaceProps?.onCommentDraftChange?.(nodeId ?? "", setDraft(tooLong));
        // ログインのためにページを離れる（OAuth でページが遷移する）。
        first.unmount();
        workspaceProps = null;

        // ログインして戻ってきた。引き継ぎを終えてから、ノートを開く。
        auth = authSignedIn("user-1");
        render(<StudyPage />);
        await screen.findByTestId("workspace");

        const reopened = workspaceProps as StudyWorkspaceProps | null;
        expect((await currentSync.load(STUDY_ID))?.owner).toBe("user-1");
        expect(reopened?.initialCommentDrafts).toEqual([{ nodeId, text: tooLong, base: "" }]);
        expect(JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}")[STUDY_ID].ownerId).toBe(
            "user-1",
        );
    });

    it("以前の形（1 つのノートに 1 つの手）で残っていた下書きも戻す", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "匿名のノート"));
        localStorage.setItem(
            DRAFTS_KEY,
            JSON.stringify({
                [STUDY_ID]: { ownerId: null, nodeId: "node", text: "前の形の下書き", at: 1 },
            }),
        );
        render(<StudyPage />);
        await screen.findByTestId("workspace");

        // 書き始めたときのコメントは分からない（画面は、自動では保存せず利用者に選ばせる）。
        expect(workspaceProps?.initialCommentDrafts).toEqual([
            { nodeId: "node", text: "前の形の下書き", base: null },
        ]);
    });

    describe("開いたあとの最初の取り込み（コメントの下書きの保存を解く合図）", () => {
        /**
         * サーバーに作成済みのアカウントのノート。取得の応答は手で進める（`release`）。
         * サーバー上のコメント（開始局面）は `remote.comment` で変えられる（別の端末の模擬）。
         */
        const prepareSyncedStudy = async (options: { held?: boolean } = {}) => {
            const doc = createTestDoc(STUDY_ID, "アカウントのノート");
            const detail = { ...doc, revision: 1, createdAt: "", updatedAt: "" };
            const remote = { comment: "他の端末のコメント C", revision: 2 };
            let release: () => void = () => {};
            const gate =
                options.held === false
                    ? Promise.resolve()
                    : new Promise<void>((resolve) => {
                          release = resolve;
                      });
            const api = createOfflineApi({
                create: vi.fn(async () => ({
                    ok: true as const,
                    status: 201,
                    data: { studyId: STUDY_ID, revision: 1 },
                })),
                get: vi.fn(async () => {
                    await gate;
                    const nodes = {
                        ...detail.tree.nodes,
                        [detail.tree.rootId]: {
                            ...detail.tree.nodes[detail.tree.rootId],
                            comment: remote.comment,
                        },
                    };
                    return {
                        ok: true as const,
                        status: 200,
                        data: {
                            study: {
                                ...detail,
                                revision: remote.revision,
                                tree: { ...detail.tree, nodes },
                            },
                        },
                    };
                }),
            });
            const store = createMemoryStudyStore();
            const seed = createTestSync(api, store);
            seed.setSession({ userId: "user-1" });
            await seed.createStudy(doc);
            await seed.flush(STUDY_ID);
            seed.dispose();
            currentSync = createTestSync(api, store);
            return { release, rootId: doc.tree.rootId, remote, store, api };
        };

        /** 書きかけを置いたあと、ログインが切れて編集が止まり、その間に別の端末がコメントを変える。 */
        const lockWithDraftThenChangeElsewhere = async () => {
            const prepared = await prepareSyncedStudy({ held: false });
            prepared.remote.comment = "";
            prepared.remote.revision = 1;
            auth = authSignedIn("user-1");
            const view = render(<StudyPage />);
            await screen.findByTestId("workspace");
            await waitFor(() => expect(workspaceProps?.commentBaseConfirmed).toBe(true));
            // コメントが空のときに書き始めた書きかけ。
            workspaceProps?.onCommentDraftChange?.(prepared.rootId, setDraft("書きかけ B"));
            auth = AUTH_SIGNED_OUT;
            view.rerender(<StudyPage />);
            await waitFor(() => expect(workspaceProps?.locked).toBe(true));
            // 別の端末が、同じ手のコメントを保存した。
            prepared.remote.comment = "別の端末のコメント C";
            prepared.remote.revision = 2;
            return { ...prepared, view };
        };
        const storedDraftTexts = (): string[] =>
            (JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}")[STUDY_ID]?.nodes ?? []).map(
                (entry: { text: string }) => entry.text,
            );

        it("ロック → 別の端末が変更 → その場で復帰: 取り込んだコメントと書きかけの両方を残して、画面に選ばせる", async () => {
            const { view, rootId } = await lockWithDraftThenChangeElsewhere();

            auth = authSignedIn("user-1");
            view.rerender(<StudyPage />);
            await waitFor(() => expect(workspaceProps?.locked).toBe(false));
            await waitFor(() => expect(workspaceProps?.commentBaseConfirmed).toBe(true));

            // 画面には、別の端末のコメントが保存済みとして渡る（書きかけで上書きしていない）。
            expect(workspaceProps?.doc.tree.nodes[rootId].comment).toBe("別の端末のコメント C");
            // 書きかけは残っている（画面のコメント欄が、この食い違いを見て選択の帯を出す）。
            expect(storedDraftTexts()).toEqual(["書きかけ B"]);
        });

        it("ロック → 別の端末が変更 → ページを開き直して復帰: 書きかけを書き始めたときのコメントと一緒に戻し、取り込んだコメントと照合させる", async () => {
            const { view, rootId } = await lockWithDraftThenChangeElsewhere();
            view.unmount();
            workspaceProps = null;

            auth = authSignedIn("user-1");
            render(<StudyPage />);
            await screen.findByTestId("workspace");
            const reopened = () => workspaceProps as StudyWorkspaceProps | null;

            // 書きかけは「空のときに書き始めた」ことと一緒に戻る。
            expect(reopened()?.initialCommentDrafts).toEqual([
                { nodeId: rootId, text: "書きかけ B", base: "" },
            ]);
            await waitFor(() => expect(reopened()?.commentBaseConfirmed).toBe(true));
            expect(reopened()?.doc.tree.nodes[rootId].comment).toBe("別の端末のコメント C");
            expect(storedDraftTexts()).toEqual(["書きかけ B"]);
        });

        it("取り込みが済むまでは「最新か分からない」と渡し、済んだら、取り込んだ内容と一緒に解く", async () => {
            const { release, rootId } = await prepareSyncedStudy();
            auth = authSignedIn("user-1");
            render(<StudyPage />);
            await screen.findByTestId("workspace");

            // 取得の応答を待っている間は、このブラウザに残っている内容を出し、保存は保留させる。
            expect(workspaceProps?.commentBaseConfirmed).toBe(false);
            expect(workspaceProps?.doc.tree.nodes[rootId].comment).toBe("");

            await act(async () => {
                release();
            });
            await waitFor(() => expect(workspaceProps?.commentBaseConfirmed).toBe(true));
            // 解いた時点で、画面の文書は取り込んだ内容になっている。
            expect(workspaceProps?.doc.tree.nodes[rootId].comment).toBe("他の端末のコメント C");
        });

        it("取り込む相手がいないノート（匿名）は、最初から保留しない", async () => {
            await currentSync.createStudy(createTestDoc(STUDY_ID, "匿名のノート"));
            render(<StudyPage />);
            await screen.findByTestId("workspace");

            expect(workspaceProps?.commentBaseConfirmed).toBe(true);
        });
    });

    it("開き直し（ログイン状態の確定）の途中で保存した編集を、古い内容で消さない", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "匿名のノート"));
        auth = AUTH_LOADING;
        const view = render(<StudyPage />);
        await screen.findByTestId("workspace");
        const nodeId = workspaceProps?.doc.tree.rootId ?? "";

        // 開き直しの途中（表示の状態の読み込み）で止める。
        const getViewState = currentSync.getViewState.bind(currentSync);
        let release: () => void = () => {};
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.spyOn(currentSync, "getViewState").mockImplementationOnce(async (id) => {
            await held;
            return getViewState(id);
        });
        const load = currentSync.load.bind(currentSync);
        const loadSpy = vi.spyOn(currentSync, "load");
        auth = AUTH_SIGNED_OUT;
        view.rerender(<StudyPage />);
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });

        // 待っている間に、コメントを保存する。
        let saved: unknown;
        act(() => {
            saved = workspaceProps?.onApplyOps([
                { type: "setComment", nodeId, value: "待機中に書いたコメント" },
            ]);
        });
        expect(await saved).toBe(true);
        // 読み出しが古い内容を返しても（読んだ直後に編集が入った場合の模擬）、読み直す。
        loadSpy.mockImplementationOnce(async (id) => {
            const stale = await load(id);
            void workspaceProps?.onApplyOps([{ type: "setTitle", value: "さらに後の編集" }]);
            return stale;
        });
        await act(async () => {
            release();
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        expect(workspaceProps?.doc.tree.nodes[nodeId]?.comment).toBe("待機中に書いたコメント");
        expect(workspaceProps?.doc.title).toBe("さらに後の編集");
        expect((await currentSync.load(STUDY_ID))?.doc.title).toBe("さらに後の編集");
    });

    it("編集の操作は画面にすぐ反映し、保存層へ流す", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "開くノート"));
        render(<StudyPage />);
        await screen.findByTestId("workspace");
        const ops: StudyOp[] = [{ type: "setTitle", value: "変えた表題" }];

        let saved: unknown;
        act(() => {
            saved = workspaceProps?.onApplyOps(ops);
        });

        expect(workspaceText()).toContain("変えた表題");
        expect(await saved).toBe(true);
        expect((await currentSync.load(STUDY_ID))?.doc.title).toBe("変えた表題");
    });

    it("保存層が受け付けなかった操作は、理由を通知して画面を元に戻し、false を返す", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "開くノート"));
        render(<StudyPage />);
        await screen.findByTestId("workspace");

        let saved: unknown;
        act(() => {
            saved = workspaceProps?.onApplyOps([{ type: "setTitle", value: "あ".repeat(201) }]);
        });

        expect(await saved).toBe(false);
        await waitFor(() => expect(workspaceProps?.notice?.text).toBe("表題が長すぎます。"));
        expect(workspaceProps?.notice?.type).toBe("error");
        await waitFor(() => expect(workspaceText()).toContain("開くノート"));
    });

    it("他のタブの変更を読み直している間の編集を、古い内容で消さない", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "開くノート"));
        let emit: (event: StudySyncEvent) => void = () => {};
        const subscribe = currentSync.subscribeEvents.bind(currentSync);
        vi.spyOn(currentSync, "subscribeEvents").mockImplementation((listener) => {
            emit = listener;
            return subscribe(listener);
        });
        render(<StudyPage />);
        await screen.findByTestId("workspace");

        // 読み直しの読み出しを途中で止める（読んだ時点の古い内容を、あとで返す）。
        const load = currentSync.load.bind(currentSync);
        let release: () => void = () => {};
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.spyOn(currentSync, "load").mockImplementationOnce(async (id) => {
            const snapshot: StoredStudy | null = await load(id);
            await held;
            return snapshot;
        });
        act(() => emit({ type: "document", studyId: STUDY_ID, origin: "other-tab" }));
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });

        // 読み直しの最中に、こちらで編集する。
        act(() => {
            void workspaceProps?.onApplyOps([{ type: "setTitle", value: "読み直し中の編集" }]);
        });
        expect(workspaceText()).toContain("読み直し中の編集");

        // 古い内容が届いても、編集は消えない。
        await act(async () => {
            release();
            await new Promise((resolve) => setTimeout(resolve, 30));
        });
        expect(workspaceText()).toContain("読み直し中の編集");
        expect((await currentSync.load(STUDY_ID))?.doc.title).toBe("読み直し中の編集");
    });

    it("前に開いていたノートの画面から届いた操作は、いま開いているノートの表示を変えない", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "1 つ目"));
        await currentSync.createStudy(createTestDoc(OTHER_ID, "2 つ目"));
        const view = render(<StudyPage />);
        await waitFor(() => expect(workspaceText()).toContain("1 つ目"));
        const firstProps = workspaceProps;

        currentStudyId = OTHER_ID;
        view.rerender(<StudyPage />);
        await waitFor(() => expect(workspaceText()).toContain("2 つ目"));

        // 1 つ目の画面に残っていた処理（解析の残りの結果など）が、遅れて操作を渡してくる。
        let saved: unknown;
        act(() => {
            saved = firstProps?.onApplyOps([{ type: "setTitle", value: "遅れて届いた変更" }]);
        });
        expect(await saved).toBe(true);

        expect(workspaceText()).toContain("2 つ目");
        expect((await currentSync.load(STUDY_ID))?.doc.title).toBe("遅れて届いた変更");
        expect((await currentSync.load(OTHER_ID))?.doc.title).toBe("2 つ目");
    });

    it("表示の状態（表示中の解析の設定と見ていた局面）を保存し、開くときに戻す", async () => {
        const doc = createTestDoc(STUDY_ID, "開くノート");
        await currentSync.createStudy(doc);
        await currentSync.setViewState(STUDY_ID, {
            selectedLayerId: "layer-1",
            currentNodeId: doc.tree.rootId,
        });
        render(<StudyPage />);
        await screen.findByTestId("workspace");

        expect(workspaceProps?.initialView).toEqual({
            selectedLayerId: "layer-1",
            currentNodeId: doc.tree.rootId,
        });
        workspaceProps?.onViewChange?.({ selectedLayerId: "layer-2", currentNodeId: "node-9" });
        await waitFor(async () =>
            expect(await currentSync.getViewState(STUDY_ID)).toMatchObject({
                selectedLayerId: "layer-2",
                currentNodeId: "node-9",
            }),
        );
    });

    it("ログインへ進む前に、ブラウザ内への書き込みが終わるのを待つ", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "開くノート"));
        const settled = vi.spyOn(currentSync, "whenLocalWritesSettled");
        const assign = vi.fn();
        vi.stubGlobal("location", { ...window.location, assign });
        render(<StudyPage />);
        await screen.findByTestId("workspace");
        settled.mockClear();

        workspaceProps?.onLogin?.();

        await waitFor(() =>
            expect(assign).toHaveBeenCalledWith(`/auth?next=%2Fstudies%2F${STUDY_ID}`),
        );
        expect(settled).toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("見出しの「ログイン」にも戻り先（このノート）を付け、書き込みが終わるのを待ってから進む", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "開くノート"));
        const settled = vi.spyOn(currentSync, "whenLocalWritesSettled");
        const assign = vi.fn();
        vi.stubGlobal("location", { ...window.location, assign });
        render(<StudyPage />);
        await screen.findByTestId("workspace");
        settled.mockClear();

        expect(headerLogin?.href).toBe(`/auth?next=%2Fstudies%2F${STUDY_ID}`);
        headerLogin?.onNavigate();

        await waitFor(() =>
            expect(assign).toHaveBeenCalledWith(`/auth?next=%2Fstudies%2F${STUDY_ID}`),
        );
        expect(settled).toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("ログイン状態を確認できなかったあとの「もう一度読み込む」は、確認からやり直す", async () => {
        // 確認そのものが失敗した（backend に届かない）。ブラウザ内にもノートは無い。
        auth = { session: null, isLoadingSession: false };
        const view = render(<StudyPage />);

        expect(
            await screen.findByRole("heading", { name: "研究ノートを読み込めませんでした" }),
        ).toBeTruthy();
        expect(screen.getByText("ログイン状態を確認できませんでした。")).toBeTruthy();
        expect(refreshSession).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
        expect(refreshSession).toHaveBeenCalledTimes(1);

        // 取り直して確認できたら、アカウントのノートが開く。
        await prepareOwnedStudy("アカウントのノート");
        resetStudySyncForTest();
        auth = authSignedIn("user-1");
        view.rerender(<StudyPage />);
        await screen.findByTestId("workspace");
        expect(workspaceText()).toContain("アカウントのノート");
    });

    it("どこにも無いノートは「見つかりません」と、未ログインならログインの案内を出す", async () => {
        render(<StudyPage />);

        expect(
            await screen.findByRole("heading", { name: "研究ノートが見つかりません" }),
        ).toBeTruthy();
        expect(screen.getByRole("link", { name: "ログイン" }).getAttribute("href")).toBe(
            `/auth?next=%2Fstudies%2F${STUDY_ID}`,
        );
        expect(screen.getByRole("link", { name: "研究ノートの一覧へ" })).toBeTruthy();
    });

    it("クラウドへの問い合わせが 401（セッション切れ）だったときは、「見つかりません」と決めつけず、確認からやり直せる", async () => {
        const unauthorized = async () => ({ ok: false as const, status: 401, error: {} });
        currentSync = createTestSync(createOfflineApi({ get: vi.fn(unauthorized) }));
        auth = authSignedIn("user-1");
        render(<StudyPage />);

        expect(
            await screen.findByRole("heading", { name: "研究ノートを読み込めませんでした" }),
        ).toBeTruthy();
        expect(screen.queryByText("研究ノートが見つかりません")).toBeNull();
        expect(dispatchAuthSessionSyncEvent).toHaveBeenCalledTimes(1);
    });

    it("クラウドに問い合わせられなかったときは、読み込めなかったと伝えて再試行できる", async () => {
        auth = authSignedIn("user-1");
        const api = createOfflineApi();
        currentSync = createTestSync(api);
        render(<StudyPage />);

        expect(
            await screen.findByRole("heading", { name: "研究ノートを読み込めませんでした" }),
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
        await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    });

    it("開いている間に削除されたら、削除されたことを出す", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "開くノート"));
        render(<StudyPage />);
        await screen.findByTestId("workspace");

        await act(async () => {
            await currentSync.deleteStudy(STUDY_ID);
        });

        expect(
            await screen.findByRole("heading", { name: "この研究ノートは削除されました" }),
        ).toBeTruthy();
    });
});
