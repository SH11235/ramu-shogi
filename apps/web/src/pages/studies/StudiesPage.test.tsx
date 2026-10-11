import type { StudySync } from "@shogi/study-client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOfflineApi, createTestDoc, createTestSync } from "./studies-test-support";

const navigate = vi.fn(async () => {});
let currentSync: StudySync;
let session: { authenticated: boolean; user: { id: string } | null } = {
    authenticated: false,
    user: null,
};

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
    useAuthSession: () => ({ session, sessionError: null, isLoadingSession: false }),
}));
vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("../../lib/studySync", () => ({
    getStudySync: () => currentSync,
    ensureStudySession: async (userId: string | null) => {
        currentSync.setSession(userId === null ? null : { userId });
    },
}));

const { default: StudiesPage } = await import("./StudiesPage");

const CSA = ["V2.2", "N+RAMU", "N-Panda", "PI", "+", "+7776FU", "-3334FU"].join("\n");
const LOCAL_ID = "11111111-1111-4111-8111-111111111111";
const CLOUD_ID = "22222222-2222-4222-8222-222222222222";

describe("StudiesPage", () => {
    beforeEach(() => {
        navigate.mockClear();
        session = { authenticated: false, user: null };
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

    it("ブラウザ内のノートとクラウドのノートを 1 つの一覧にする", async () => {
        session = { authenticated: true, user: { id: "user-1" } };
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
            screen.getByRole("link", { name: "ログインすると保存できます" }).getAttribute("href"),
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
});
