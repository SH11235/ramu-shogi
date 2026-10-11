import type { StudyOp } from "@shogi/app-core";
import type { StudySync } from "@shogi/study-client";
import type { StudyWorkspaceProps } from "@shogi/ui";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOfflineApi, createTestDoc, createTestSync } from "./studies-test-support";

const STUDY_ID = "11111111-1111-4111-8111-111111111111";
const navigate = vi.fn(async () => {});
let currentSync: StudySync;
let session: { authenticated: boolean; user: { id: string } | null } = {
    authenticated: false,
    user: null,
};
let workspaceProps: StudyWorkspaceProps | null = null;

vi.mock("@tanstack/react-router", () => ({
    getRouteApi: () => ({ useParams: () => ({ studyId: STUDY_ID }) }),
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
    useNavigate: () => navigate,
}));
vi.mock("../../hooks/useAuthSession", () => ({
    useAuthSession: () => ({ session, sessionError: null, isLoadingSession: false }),
    dispatchAuthSessionSyncEvent: vi.fn(),
}));
vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("../../platform/wasm-engine-client", () => ({ createWebWasmEngineClient: vi.fn() }));
vi.mock("../../lib/studySync", () => ({
    getStudySync: () => currentSync,
    ensureStudySession: async (userId: string | null) => {
        currentSync.setSession(userId === null ? null : { userId });
    },
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

const { default: StudyPage } = await import("./StudyPage");

describe("StudyPage", () => {
    beforeEach(() => {
        navigate.mockClear();
        workspaceProps = null;
        session = { authenticated: false, user: null };
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

    it("編集の操作は画面にすぐ反映し、保存層へ流す", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "開くノート"));
        render(<StudyPage />);
        await screen.findByTestId("workspace");
        const ops: StudyOp[] = [{ type: "setTitle", value: "変えた表題" }];

        act(() => workspaceProps?.onApplyOps(ops));

        expect(screen.getByTestId("workspace").textContent).toContain("変えた表題");
        await waitFor(async () =>
            expect((await currentSync.load(STUDY_ID))?.doc.title).toBe("変えた表題"),
        );
    });

    it("保存層が受け付けなかった操作は、理由を出して画面を元に戻す", async () => {
        await currentSync.createStudy(createTestDoc(STUDY_ID, "開くノート"));
        render(<StudyPage />);
        await screen.findByTestId("workspace");

        act(() => workspaceProps?.onApplyOps([{ type: "setTitle", value: "あ".repeat(201) }]));

        expect((await screen.findByRole("alert")).textContent).toContain("表題が長すぎます");
        await waitFor(() =>
            expect(screen.getByTestId("workspace").textContent).toContain("開くノート"),
        );
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
        session = { authenticated: true, user: { id: "user-1" } };
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
