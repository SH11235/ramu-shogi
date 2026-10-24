import { createStudyDocumentFromMoves, type StudyDocument, type StudyOp } from "@shogi/app-core";
import {
    createMemoryStudyStore,
    createStudySync,
    type StudyApi,
    type StudySync,
} from "@shogi/study-client";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 研究ノートの画面そのもの（盤・解析）は ui 側で確かめている。ここでは、Desktop の保存との
// つなぎ（開く・操作を流す・拒否されたら戻す）だけを見るので、受け取った値を出すだけの部品にする。
const workspace = vi.hoisted(() => ({
    onApplyOps: null as ((ops: unknown[]) => unknown) | null,
}));
vi.mock("@shogi/ui", () => ({
    StudyWorkspace: (props: {
        doc: StudyDocument;
        onApplyOps: (ops: StudyOp[]) => unknown;
        notice?: { text: string } | null;
        engineOptions: Array<{ id: string }>;
    }) => {
        workspace.onApplyOps = props.onApplyOps as (ops: unknown[]) => unknown;
        return (
            <div>
                <p data-testid="title">{props.doc.title}</p>
                <p data-testid="nodes">{Object.keys(props.doc.tree.nodes).length}</p>
                <p data-testid="engines">{props.engineOptions.map((e) => e.id).join(",")}</p>
                {props.notice && <p role="alert">{props.notice.text}</p>}
            </div>
        );
    },
    NnueLibraryDialog: () => null,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));
vi.mock("@shogi/engine-tauri", () => ({
    getLegalMoves: vi.fn(async () => []),
    createTauriNnueStorage: vi.fn(),
    createTauriEngineClient: vi.fn(),
}));

const { StudyView } = await import("./StudyView");

const unreachable = vi.fn(
    async () => ({ ok: false, status: 0, error: { error: "NETWORK_ERROR" } }) as const,
);
const api: StudyApi = {
    list: unreachable,
    create: unreachable,
    get: unreachable,
    postOps: unreachable,
    delete: unreachable,
    limits: unreachable,
};

const createSync = (): StudySync => {
    const sync = createStudySync({ store: createMemoryStudyStore(), api });
    sync.setSession(null);
    return sync;
};

const STUDY_ID = "11111111-1111-4111-8111-111111111111";
const createDoc = () =>
    createStudyDocumentFromMoves({
        id: STUDY_ID,
        title: "テストのノート",
        origin: { kind: "paste", ref: null },
        startSfen: "startpos",
        moves: ["7g7f", "3c3d"],
        meta: {},
    });

const engineOptions = [
    { id: "native", label: "内蔵エンジン", createClient: vi.fn(), kind: "internal" as const },
];

const renderView = (sync: StudySync, studyId = STUDY_ID) =>
    render(
        <StudyView
            sync={sync}
            studyId={studyId}
            engineOptions={engineOptions}
            onBackToList={vi.fn()}
            onBackToLocal={vi.fn()}
            onPlayFromPosition={vi.fn()}
        />,
    );

describe("StudyView（Desktop の研究ノートの画面）", () => {
    afterEach(() => cleanup());

    it("この端末のノートを開いて、画面に渡す", async () => {
        const sync = createSync();
        await sync.createStudy(createDoc());
        renderView(sync);

        expect((await screen.findByTestId("title")).textContent).toBe("テストのノート");
        expect(screen.getByTestId("nodes").textContent).toBe("3");
        expect(screen.getByTestId("engines").textContent).toBe("native");
    });

    it("サーバーへは何も送らない（保存はこの端末の中だけ）", async () => {
        unreachable.mockClear();
        const sync = createSync();
        await sync.createStudy(createDoc());
        renderView(sync);
        await screen.findByTestId("title");
        await act(async () => {
            await workspace.onApplyOps?.([
                { type: "addMoves", parentId: createDoc().tree.rootId, moves: ["2g2f"] },
            ]);
        });
        await sync.flush(STUDY_ID).catch(() => undefined);

        expect(unreachable).not.toHaveBeenCalled();
    });

    it("ノートを読めなかったときは、無いとは言わずに、読めなかったと知らせる", async () => {
        const sync = createSync();
        await sync.createStudy(createDoc());
        sync.load = async () => {
            throw new Error("保存領域を開けません");
        };
        renderView(sync);

        expect((await screen.findByRole("alert")).textContent).toContain("保存領域を開けません");
        expect(screen.queryByText(/この端末にありません/)).toBeNull();
    });

    it("この端末に無いノートは、そう知らせる", async () => {
        renderView(createSync(), "99999999-9999-4999-8999-999999999999");
        expect(await screen.findByText(/この研究ノートは、この端末にありません/)).toBeTruthy();
    });

    it("編集の操作は、画面にすぐ反映して保存層へ流す", async () => {
        const sync = createSync();
        const doc = createDoc();
        await sync.createStudy(doc);
        renderView(sync);
        await screen.findByTestId("title");

        let saved: unknown;
        await act(async () => {
            saved = await workspace.onApplyOps?.([
                { type: "addMoves", parentId: doc.tree.rootId, moves: ["2g2f"] },
            ]);
        });

        expect(saved).toBe(true);
        expect(screen.getByTestId("nodes").textContent).toBe("4");
        const stored = await sync.load(STUDY_ID);
        expect(Object.keys(stored?.doc.tree.nodes ?? {})).toHaveLength(4);
    });

    it("保存層が受け付けなかった操作は、理由を出して、画面を保存済みの内容に戻す", async () => {
        const sync = createSync();
        await sync.createStudy(createDoc());
        renderView(sync);
        await screen.findByTestId("title");

        let saved: unknown;
        await act(async () => {
            // 表題の上限（200 文字）を超える。
            saved = await workspace.onApplyOps?.([{ type: "setTitle", value: "あ".repeat(201) }]);
        });

        expect(saved).toBe(false);
        expect((await screen.findByRole("alert")).textContent).toContain("表題が長すぎます");
        await waitFor(() => expect(screen.getByTestId("title").textContent).toBe("テストのノート"));
    });

    it("開いている間に削除されたら、そう知らせる", async () => {
        const sync = createSync();
        await sync.createStudy(createDoc());
        renderView(sync);
        await screen.findByTestId("title");

        await act(async () => {
            await sync.deleteStudy(STUDY_ID);
        });

        expect(await screen.findByText("この研究ノートは削除されました。")).toBeTruthy();
    });

    it("一覧・ローカル対局へ戻るボタンを出す", async () => {
        const sync = createSync();
        await sync.createStudy(createDoc());
        const onBackToList = vi.fn();
        render(
            <StudyView
                sync={sync}
                studyId={STUDY_ID}
                engineOptions={engineOptions}
                onBackToList={onBackToList}
                onBackToLocal={vi.fn()}
                onPlayFromPosition={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: "← 研究ノートの一覧へ戻る" }));
        expect(onBackToList).toHaveBeenCalledTimes(1);
    });
});
