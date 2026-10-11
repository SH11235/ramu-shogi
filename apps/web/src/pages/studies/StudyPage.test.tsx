import type { StudyOp } from "@shogi/app-core";
import {
    createMemoryStudyStore,
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
vi.mock("../../hooks/useAuthSession", () => ({
    useAuthSession: () => ({ ...auth, sessionError: null }),
    dispatchAuthSessionSyncEvent: vi.fn(),
}));
vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));
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
        workspaceProps = null;
        currentStudyId = STUDY_ID;
        auth = AUTH_SIGNED_OUT;
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

    it("ログアウトしたら、開いていたアカウントのノートを閉じる", async () => {
        await prepareOwnedStudy("アカウントのノート");
        auth = authSignedIn("user-1");
        const view = render(<StudyPage />);
        await screen.findByTestId("workspace");

        auth = AUTH_SIGNED_OUT;
        view.rerender(<StudyPage />);

        expect(
            await screen.findByRole("heading", { name: "研究ノートが見つかりません" }),
        ).toBeTruthy();
        expect(screen.queryByTestId("workspace")).toBeNull();
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
