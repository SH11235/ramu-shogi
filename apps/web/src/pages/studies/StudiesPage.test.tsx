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
        children,
    }: {
        to: string;
        params?: { studyId?: string };
        children: ReactNode;
    }) => <a href={params?.studyId ? to.replace("$studyId", params.studyId) : to}>{children}</a>,
    useNavigate: () => navigate,
}));
vi.mock("../../hooks/useAuthSession", () => ({
    useAuthSession: () => ({ ...auth, sessionError: null }),
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
        ).toBe("/rshogi-viewer");
        expect(screen.getByRole("link", { name: /自分の対局から選ぶ/ }).getAttribute("href")).toBe(
            "/games",
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
            target: { value: "startpos" },
        });
        fireEvent.click(screen.getByRole("button", { name: "研究ノートにする" }));

        expect((await screen.findByRole("alert")).textContent).toContain("指し手がありません");
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
