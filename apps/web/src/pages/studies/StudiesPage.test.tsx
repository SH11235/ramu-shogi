import { createMemoryStudyStore, createStudySync, type StudySync } from "@shogi/study-client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    AUTH_SIGNED_OUT,
    authSignedIn,
    createOfflineApi,
    createTestDoc,
    createTestSync,
    type TestAuthState,
} from "./studies-test-support";

const navigate = vi.fn(async () => {});
let currentSync: StudySync;
let auth: TestAuthState = AUTH_SIGNED_OUT;
const dispatchAuthSessionSyncEvent = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    Link: ({
        to,
        params,
        search,
        children,
    }: {
        to: string;
        params?: { studyId?: string };
        search?: Record<string, string>;
        children: ReactNode;
    }) => {
        const path = params?.studyId ? to.replace("$studyId", params.studyId) : to;
        const query = search ? new URLSearchParams(search).toString() : "";
        return <a href={query ? `${path}?${query}` : path}>{children}</a>;
    },
    useNavigate: () => navigate,
}));
vi.mock("../../hooks/useAuthSession", () => ({
    useAuthSession: () => ({ sessionError: null, ...auth }),
    dispatchAuthSessionSyncEvent: () => dispatchAuthSessionSyncEvent(),
}));
vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));
// `lib/studySync`（セッションの伝達・引き継ぎ）は本物を使い、その下の同期エンジンだけを差し替える。
vi.mock("@shogi/study-client", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@shogi/study-client")>()),
    createBrowserStudySync: () => ({ sync: currentSync, store: null, dispose: () => {} }),
}));

const { resetStudySyncForTest } = await import("../../lib/studySync");
const { default: StudiesPage } = await import("./StudiesPage");

const CSA = ["V2.2", "N+RAMU", "N-Panda", "PI", "+", "+7776FU", "-3334FU"].join("\n");
const LOCAL_ID = "11111111-1111-4111-8111-111111111111";
const CLOUD_ID = "22222222-2222-4222-8222-222222222222";

describe("StudiesPage", () => {
    beforeEach(() => {
        navigate.mockClear();
        dispatchAuthSessionSyncEvent.mockClear();
        auth = AUTH_SIGNED_OUT;
        localStorage.clear();
        resetStudySyncForTest();
        currentSync = createTestSync();
    });

    it("0 件のときは、棋譜を取り込む導線を主役にする", async () => {
        render(<StudiesPage api={createOfflineApi()} />);

        expect(
            await screen.findByRole("heading", { name: "棋譜を取り込んで、研究ノートを作る" }),
        ).toBeTruthy();
        expect(screen.getByRole("textbox", { name: "棋譜のテキスト" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "ファイルを選ぶ" })).toBeTruthy();
        expect(
            screen.getByRole("link", { name: "観戦・棋譜一覧から選ぶ" }).getAttribute("href"),
        ).toBe("/studies/new");
        expect(screen.getByRole("link", { name: /自分の対局から選ぶ/ }).getAttribute("href")).toBe(
            "/studies/new?from=games",
        );
    });

    it("貼り付けた棋譜から研究ノートを作って、その画面へ移る", async () => {
        render(<StudiesPage api={createOfflineApi()} />);

        fireEvent.change(await screen.findByRole("textbox", { name: "棋譜のテキスト" }), {
            target: { value: CSA },
        });
        fireEvent.click(screen.getByRole("button", { name: "研究ノートにする" }));

        await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
        const local = await currentSync.listLocal();
        expect(local).toHaveLength(1);
        expect(local[0].title).toBe("RAMU 対 Panda");
        expect(navigate).toHaveBeenCalledWith({
            to: "/studies/$studyId",
            params: { studyId: local[0].id },
        });
    });

    it("読めない棋譜は、理由を出して作らない", async () => {
        render(<StudiesPage api={createOfflineApi()} />);

        fireEvent.change(await screen.findByRole("textbox", { name: "棋譜のテキスト" }), {
            target: { value: "こんにちは" },
        });
        fireEvent.click(screen.getByRole("button", { name: "研究ノートにする" }));

        expect((await screen.findByRole("alert")).textContent).toContain(
            "棋譜の形式を判別できませんでした",
        );
        expect(navigate).not.toHaveBeenCalled();
    });

    it("同期エンジンがセッションの変化を知らせたら、ログイン状態を取り直す", async () => {
        auth = authSignedIn("user-1");
        // 別のタブでログアウトしていた（作成の直前の確認で分かる）。
        currentSync = createStudySync({
            store: createMemoryStudyStore(),
            api: createOfflineApi(),
            verifySession: async () => null,
        });
        render(<StudiesPage api={createOfflineApi()} />);
        await screen.findByRole("textbox", { name: "棋譜のテキスト" });
        expect(dispatchAuthSessionSyncEvent).not.toHaveBeenCalled();

        await currentSync.createStudy(createTestDoc(LOCAL_ID, "ブラウザのノート"));
        await waitFor(() => expect(dispatchAuthSessionSyncEvent).toHaveBeenCalledTimes(1));
    });

    describe("一覧の取得が 401（セッション切れ）", () => {
        const unauthorized = async () => ({ ok: false as const, status: 401, error: {} });

        it("ログイン状態を取り直し、未ログインと分かれば、未ログインの表示になって一覧の API を呼ばない", async () => {
            auth = authSignedIn("user-1");
            const api = createOfflineApi({ list: vi.fn(unauthorized) });
            const view = render(<StudiesPage api={api} />);

            await waitFor(() => expect(dispatchAuthSessionSyncEvent).toHaveBeenCalledTimes(1));

            // 取り直した結果、未ログインだった。
            auth = { ...authSignedIn("user-1"), isLoadingSession: true };
            view.rerender(<StudiesPage api={api} />);
            auth = AUTH_SIGNED_OUT;
            view.rerender(<StudiesPage api={api} />);
            expect(
                await screen.findByRole("heading", { name: "棋譜を取り込んで、研究ノートを作る" }),
            ).toBeTruthy();
            expect(screen.queryByText(/読み込めませんでした/)).toBeNull();
            // 未ログインでは一覧の API を呼ばないので、取り直しは繰り返さない。
            await new Promise((resolve) => setTimeout(resolve, 30));
            expect(api.list).toHaveBeenCalledTimes(1);
            expect(dispatchAuthSessionSyncEvent).toHaveBeenCalledTimes(1);
        });

        it("取り直しても同じユーザーのまま 401 が続くときは、取り直しを繰り返さず、読み込めなかったと伝える", async () => {
            auth = authSignedIn("user-1");
            const api = createOfflineApi({ list: vi.fn(unauthorized) });
            const view = render(<StudiesPage api={api} />);
            await waitFor(() => expect(dispatchAuthSessionSyncEvent).toHaveBeenCalledTimes(1));

            auth = { ...authSignedIn("user-1"), isLoadingSession: true };
            view.rerender(<StudiesPage api={api} />);
            auth = authSignedIn("user-1");
            view.rerender(<StudiesPage api={api} />);

            expect(
                await screen.findByText(/クラウドに保存した研究ノートを読み込めませんでした/),
            ).toBeTruthy();
            expect(api.list).toHaveBeenCalledTimes(2);
            expect(dispatchAuthSessionSyncEvent).toHaveBeenCalledTimes(1);
        });
    });

    it("ブラウザ内のノートとクラウドのノートを 1 つの一覧にする", async () => {
        auth = authSignedIn("user-1");
        currentSync.setSession({ userId: "user-1" });
        await currentSync.createStudy(createTestDoc(LOCAL_ID, "ブラウザのノート"));
        const api = createOfflineApi({
            list: vi.fn(async () => ({
                ok: true as const,
                status: 200,
                data: {
                    studies: [
                        {
                            id: CLOUD_ID,
                            title: "クラウドのノート",
                            origin: { kind: "rshogi_csa" as const, ref: "wdoor-1" },
                            meta: { blackName: "RAMU", whiteName: "Panda" },
                            revision: 4,
                            nodeCount: 114,
                            layerCount: 1,
                            resultCount: 114,
                            updatedAt: "2026-10-01T00:00:00.000Z",
                        },
                    ],
                    nextCursor: null,
                },
            })),
        });

        render(<StudiesPage api={api} />);

        const cloud = await screen.findByRole("link", { name: /クラウドのノート/ });
        expect(cloud.getAttribute("href")).toBe(`/studies/${CLOUD_ID}`);
        expect(cloud.textContent).toContain("☗RAMU 対 ☖Panda");
        expect(cloud.textContent).toContain("観戦・棋譜一覧の棋譜");
        expect(cloud.textContent).toContain("解析済み");
        expect(cloud.textContent).toContain("クラウドに保存済み");
        const local = screen.getByRole("link", { name: /ブラウザのノート/ });
        expect(local.textContent).toContain("未解析");
        expect(screen.getByText("2 件")).toBeTruthy();
        // 一覧があるときは、取り込みは畳んでおく。
        expect(screen.queryByRole("textbox", { name: "棋譜のテキスト" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "棋譜を取り込む" }));
        expect(screen.getByRole("textbox", { name: "棋譜のテキスト" })).toBeTruthy();
    });

    it("未ログインでは、ブラウザ内にだけ保存されていることと、ログインの案内を出す", async () => {
        await currentSync.createStudy(createTestDoc(LOCAL_ID, "ブラウザのノート"));
        const api = createOfflineApi();
        render(<StudiesPage api={api} />);

        const link = await screen.findByRole("link", { name: /ブラウザのノート/ });
        expect(link.textContent).toContain("このブラウザに保存");
        expect(
            screen
                .getByRole("link", { name: "ログインするとクラウドにも保存できます" })
                .getAttribute("href"),
        ).toBe("/auth?next=%2Fstudies");
        expect(api.list).not.toHaveBeenCalled();
    });

    it("削除は確認してから行う", async () => {
        await currentSync.createStudy(createTestDoc(LOCAL_ID, "消すノート"));
        render(<StudiesPage api={createOfflineApi()} />);

        fireEvent.click(await screen.findByRole("button", { name: "「消すノート」を削除" }));
        const dialog = await screen.findByRole("alertdialog");
        expect(dialog.textContent).toContain("元に戻せません");
        expect(await currentSync.listLocal()).toHaveLength(1);

        fireEvent.click(within(dialog).getByRole("button", { name: "削除する" }));

        await waitFor(async () => expect(await currentSync.listLocal()).toHaveLength(0));
        // 0 件になったら、取り込みの導線に戻る。
        expect(
            await screen.findByRole("heading", { name: "棋譜を取り込んで、研究ノートを作る" }),
        ).toBeTruthy();
    });

    describe("クラウドにだけあるノートの削除が 404 だったとき", () => {
        const DRAFTS_KEY = "ramu-study-comment-drafts";
        const cloudApi = () =>
            createOfflineApi({
                list: vi.fn(async () => ({
                    ok: true as const,
                    status: 200,
                    data: {
                        studies: [
                            {
                                id: CLOUD_ID,
                                title: "クラウドのノート",
                                origin: { kind: "paste" as const, ref: null },
                                meta: {},
                                revision: 1,
                                nodeCount: 3,
                                layerCount: 0,
                                resultCount: 0,
                                updatedAt: "2026-10-01T00:00:00.000Z",
                            },
                        ],
                        nextCursor: null,
                    },
                })),
                delete: vi.fn(async () => ({ ok: false as const, status: 404, error: {} })),
            });
        /** user-1 の一覧からクラウドのノートの削除を確定する。 */
        const deleteCloudStudy = async (
            verifySession: () => Promise<{ userId: string } | null>,
        ): Promise<void> => {
            auth = authSignedIn("user-1");
            localStorage.setItem(
                DRAFTS_KEY,
                JSON.stringify({
                    [CLOUD_ID]: { ownerId: "user-1", nodes: [{ nodeId: "n", text: "下書き" }] },
                }),
            );
            render(<StudiesPage api={cloudApi()} verifySession={verifySession} />);
            fireEvent.click(
                await screen.findByRole("button", { name: "「クラウドのノート」を削除" }),
            );
            const dialog = await screen.findByRole("alertdialog");
            fireEvent.click(within(dialog).getByRole("button", { name: "削除する" }));
        };
        const hasDraft = (): boolean =>
            Object.hasOwn(JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}"), CLOUD_ID);

        it("サーバーから見たログイン状態が一覧の持ち主のままなら、削除済みとして一覧と下書きから消す", async () => {
            await deleteCloudStudy(async () => ({ userId: "user-1" }));

            await waitFor(() =>
                expect(screen.queryByRole("link", { name: /クラウドのノート/ })).toBeNull(),
            );
            expect(hasDraft()).toBe(false);
            expect(dispatchAuthSessionSyncEvent).not.toHaveBeenCalled();
        });

        it.each([
            ["別のアカウントに切り替わっていた", async () => ({ userId: "user-2" })],
            ["ログアウトしていた", async () => null],
        ])("別のタブで%sら、一覧からも下書きからも消さず、ログイン状態を取り直す", async (_, verifySession) => {
            await deleteCloudStudy(verifySession);

            expect(
                (await screen.findByText(/研究ノートを削除できませんでした/)).textContent,
            ).toContain("ログイン状態が変わっています");
            expect(screen.getByRole("link", { name: /クラウドのノート/ })).toBeTruthy();
            expect(hasDraft()).toBe(true);
            expect(dispatchAuthSessionSyncEvent).toHaveBeenCalledTimes(1);
        });

        it("削除の確認を開いたあとにアカウントが変わったら、確認を閉じ、前のアカウントのノートも下書きも消さない", async () => {
            const api = cloudApi();
            // サーバーから見たログイン状態は、切り替わったあとの user-2。
            const verifySession = vi.fn(async () => ({ userId: "user-2" }));
            auth = authSignedIn("user-1");
            localStorage.setItem(
                DRAFTS_KEY,
                JSON.stringify({
                    [CLOUD_ID]: { ownerId: "user-1", nodes: [{ nodeId: "n", text: "下書き" }] },
                }),
            );
            const view = render(<StudiesPage api={api} verifySession={verifySession} />);
            fireEvent.click(
                await screen.findByRole("button", { name: "「クラウドのノート」を削除" }),
            );
            await screen.findByRole("alertdialog");

            // 別のタブで user-2 に切り替わり、この画面のログイン状態も user-2 になった。
            auth = authSignedIn("user-2");
            view.rerender(<StudiesPage api={api} verifySession={verifySession} />);
            // 確認が残っていたら、そのまま確定する（user-2 のセッションでは 404 が返る）。
            await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
            const confirm = screen.queryByRole("button", { name: "削除する" });
            if (confirm) fireEvent.click(confirm);
            await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(hasDraft()).toBe(true);
            expect(api.delete).not.toHaveBeenCalled();
        });

        it("ログイン状態を確かめられなければ、消さない", async () => {
            await deleteCloudStudy(async () => {
                throw new Error("Failed to fetch");
            });

            expect(await screen.findByText(/ログイン状態を確認できませんでした/)).toBeTruthy();
            expect(screen.getByRole("link", { name: /クラウドのノート/ })).toBeTruthy();
            expect(hasDraft()).toBe(true);
        });
    });

    it("アカウントが変わったら、前のアカウントの一覧と続きの位置を残さない", async () => {
        const cloudNote = (id: string, title: string) => ({
            id,
            title,
            origin: { kind: "paste" as const, ref: null },
            meta: {},
            revision: 1,
            nodeCount: 10,
            layerCount: 0,
            resultCount: 0,
            updatedAt: "2026-10-01T00:00:00.000Z",
        });
        const api = createOfflineApi({
            // セッション（Cookie）のアカウントのノートだけを返すサーバーの模擬。
            list: vi.fn(async () => {
                const userId = currentSync.getSession()?.userId;
                return {
                    ok: true as const,
                    status: 200,
                    data:
                        userId === "user-1"
                            ? {
                                  studies: [cloudNote(CLOUD_ID, "user-1 のノート")],
                                  nextCursor: "c1",
                              }
                            : { studies: [], nextCursor: null },
                };
            }),
        });
        auth = authSignedIn("user-1");
        const view = render(<StudiesPage api={api} />);
        expect(await screen.findByRole("link", { name: /user-1 のノート/ })).toBeTruthy();
        expect(screen.getByRole("button", { name: "もっと見る" })).toBeTruthy();

        auth = authSignedIn("user-2");
        view.rerender(<StudiesPage api={api} />);

        await waitFor(() =>
            expect(screen.queryByRole("link", { name: /user-1 のノート/ })).toBeNull(),
        );
        expect(screen.queryByRole("button", { name: "もっと見る" })).toBeNull();
        expect(
            await screen.findByRole("heading", { name: "棋譜を取り込んで、研究ノートを作る" }),
        ).toBeTruthy();
    });

    it("続きを読み込んでいる間にアカウントが変わったら、前のアカウントの続きを足さない", async () => {
        let releaseMore: () => void = () => {};
        const held = new Promise<void>((resolve) => {
            releaseMore = resolve;
        });
        const page = (title: string, id: string, nextCursor: string | null) => ({
            ok: true as const,
            status: 200,
            data: {
                studies: [
                    {
                        id,
                        title,
                        origin: { kind: "paste" as const, ref: null },
                        meta: {},
                        revision: 1,
                        nodeCount: 10,
                        layerCount: 0,
                        resultCount: 0,
                        updatedAt: "2026-10-01T00:00:00.000Z",
                    },
                ],
                nextCursor,
            },
        });
        const api = createOfflineApi({
            list: vi.fn(async (params) => {
                if (params?.cursor === "c1") {
                    await held;
                    return page("user-1 の続き", LOCAL_ID, null);
                }
                return currentSync.getSession()?.userId === "user-1"
                    ? page("user-1 のノート", CLOUD_ID, "c1")
                    : { ok: true as const, status: 200, data: { studies: [], nextCursor: null } };
            }),
        });
        auth = authSignedIn("user-1");
        const view = render(<StudiesPage api={api} />);
        fireEvent.click(await screen.findByRole("button", { name: "もっと見る" }));

        auth = authSignedIn("user-2");
        view.rerender(<StudiesPage api={api} />);
        await waitFor(() =>
            expect(screen.queryByRole("link", { name: /user-1 のノート/ })).toBeNull(),
        );
        releaseMore();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(screen.queryByRole("link", { name: /user-1 の続き/ })).toBeNull();
    });
});
