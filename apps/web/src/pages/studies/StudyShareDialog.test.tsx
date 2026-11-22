import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudyShareDialog } from "./StudyShareDialog";
import { createTestDoc } from "./studies-test-support";

const studyId = "11111111-1111-4111-8111-111111111111";

describe("StudyShareDialog", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("リンク共有を有効にして URL をコピーし、非公開に戻せる", async () => {
        const api = {
            get: vi.fn(async () => ({
                ok: true as const,
                status: 200,
                data: {
                    study: {
                        ...createTestDoc(studyId, "研究ノート"),
                        revision: 1,
                        createdAt: "",
                        updatedAt: "",
                        visibility: "private" as const,
                    },
                },
            })),
            setVisibility: vi.fn(async () => ({ ok: true as const, status: 204, data: null })),
        };
        const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
        render(
            <StudyShareDialog
                studyId={studyId}
                api={api}
                unavailableReason={null}
                onClose={() => {}}
            />,
        );

        const unlisted = await screen.findByRole("button", {
            name: "リンクを知っている人が閲覧可",
        });
        expect(screen.queryByRole("textbox", { name: "共有リンク" })).toBeNull();
        fireEvent.click(unlisted);
        expect(api.setVisibility).toHaveBeenNthCalledWith(1, studyId, { visibility: "unlisted" });

        fireEvent.click(await screen.findByRole("button", { name: "コピー" }));
        expect(copy).toHaveBeenCalledWith(`${window.location.origin}/studies/${studyId}`);
        expect(await screen.findByText("共有リンクをコピーしました。")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "非公開" }));
        expect(api.setVisibility).toHaveBeenNthCalledWith(2, studyId, { visibility: "private" });
        await screen.findByText("公開設定を保存しました。");
        expect(screen.queryByRole("textbox", { name: "共有リンク" })).toBeNull();
    });

    it("未ログインなら API を呼ばずに共有できない理由を出す", () => {
        const api = { get: vi.fn(), setVisibility: vi.fn() };
        const unavailableReason = "ログインしてクラウドに保存すると共有できます。";
        render(
            <StudyShareDialog
                studyId={studyId}
                api={api}
                unavailableReason={unavailableReason}
                onClose={() => {}}
            />,
        );

        expect(screen.getByText(unavailableReason)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "リンクを知っている人が閲覧可" })).toBeNull();
        expect(api.get).not.toHaveBeenCalled();
    });

    it("クラウドにまだないノートは共有できない理由を出す", async () => {
        const api = {
            get: vi.fn(async () => ({ ok: false as const, status: 404, error: {} })),
            setVisibility: vi.fn(),
        };
        render(
            <StudyShareDialog
                studyId={studyId}
                api={api}
                unavailableReason={null}
                onClose={() => {}}
            />,
        );

        expect(await screen.findByText("クラウドに保存すると共有できます。")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "リンクを知っている人が閲覧可" })).toBeNull();
        expect(api.setVisibility).not.toHaveBeenCalled();
    });
});
