import { createStudyDocumentFromMoves } from "@shogi/app-core";
import {
    createMemoryStudyStore,
    createStudySync,
    type StudyApi,
    type StudySync,
} from "@shogi/study-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudiesView } from "./StudiesView";

const unreachable = async () =>
    ({ ok: false, status: 0, error: { error: "NETWORK_ERROR" } }) as const;
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

const createDoc = (id: string, title: string) =>
    createStudyDocumentFromMoves({
        id,
        title,
        origin: { kind: "paste", ref: null },
        startSfen: "startpos",
        moves: ["7g7f", "3c3d"],
        meta: { blackName: "先手太郎", whiteName: "後手花子" },
    });

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";

describe("StudiesView（Desktop の研究ノートの一覧）", () => {
    afterEach(() => cleanup());

    it("この端末のノートを並べ、押すと開く", async () => {
        const sync = createSync();
        await sync.createStudy(createDoc(FIRST, "最初のノート"));
        await sync.createStudy(createDoc(SECOND, "次のノート"));
        const onOpenStudy = vi.fn();
        render(<StudiesView sync={sync} onBackToLocal={vi.fn()} onOpenStudy={onOpenStudy} />);

        expect(await screen.findByText("最初のノート")).toBeTruthy();
        expect(screen.getByText("次のノート")).toBeTruthy();
        expect(screen.getByText("2 件")).toBeTruthy();
        expect(screen.getAllByText("☗先手太郎 対 ☖後手花子")).toHaveLength(2);
        expect(screen.getAllByText("未解析")).toHaveLength(2);

        fireEvent.click(screen.getByText("次のノート"));
        expect(onOpenStudy).toHaveBeenCalledWith(SECOND);
    });

    it("ノートが無くても、取り込みの欄は出る", async () => {
        render(<StudiesView sync={createSync()} onBackToLocal={vi.fn()} onOpenStudy={vi.fn()} />);
        expect(await screen.findByRole("textbox", { name: "棋譜のテキスト" })).toBeTruthy();
        await waitFor(() => expect(screen.queryByText("読み込み中...")).toBeNull());
        expect(screen.queryByText(/件$/)).toBeNull();
    });

    it("削除は確認してから行い、一覧から消える", async () => {
        const sync = createSync();
        await sync.createStudy(createDoc(FIRST, "消すノート"));
        render(<StudiesView sync={sync} onBackToLocal={vi.fn()} onOpenStudy={vi.fn()} />);

        fireEvent.click(await screen.findByRole("button", { name: "「消すノート」を削除" }));
        // やめれば残る。
        fireEvent.click(screen.getByRole("button", { name: "やめる" }));
        expect(screen.getByText("消すノート")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "「消すノート」を削除" }));
        fireEvent.click(screen.getByRole("button", { name: "削除する" }));
        await waitFor(() => expect(screen.queryByText("消すノート")).toBeNull());
        expect(await sync.listLocal()).toEqual([]);
    });
});
