import type { StudyVisibility } from "@shogi/api-contract";
import type { StudyApiClient } from "@shogi/study-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudyShareDialog } from "./StudyShareDialog";
import { createTestDoc } from "./studies-test-support";

const studyId = "11111111-1111-4111-8111-111111111111";
const studyWithVisibility = (visibility: StudyVisibility) => ({
    ok: true as const,
    status: 200,
    data: {
        study: {
            ...createTestDoc(studyId, "研究ノート"),
            revision: 1,
            createdAt: "",
            updatedAt: "",
            visibility,
        },
    },
});
const networkFailure = { ok: false as const, status: 0, error: {} };

describe("StudyShareDialog", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("リンク共有を有効にして URL をコピーし、非公開に戻せる", async () => {
        const api = {
            get: vi.fn(async () => studyWithVisibility("private")),
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

    it.each(["focus", "visibilitychange"])(
        "%s で同じ revision の公開設定を読み直す",
        async (event) => {
            const api = {
                get: vi
                    .fn(async () => studyWithVisibility("private"))
                    .mockResolvedValueOnce(studyWithVisibility("private"))
                    .mockResolvedValueOnce(studyWithVisibility("unlisted")),
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
            await screen.findByRole("button", { name: "非公開", pressed: true });

            if (event === "focus") {
                fireEvent.focus(window);
            } else {
                const visibility = vi
                    .spyOn(document, "visibilityState", "get")
                    .mockReturnValue("hidden");
                fireEvent(document, new Event("visibilitychange"));
                expect(api.get).toHaveBeenCalledTimes(1);
                visibility.mockReturnValue("visible");
                fireEvent(document, new Event("visibilitychange"));
            }
            await screen.findByRole("textbox", { name: "共有リンク" });
            expect(api.get).toHaveBeenCalledTimes(2);
        },
    );

    it("表示と同じ非公開を送信し、保存前に始まった GET では上書きされない", async () => {
        let replyToRefresh: (result: ReturnType<typeof studyWithVisibility>) => void = () => {};
        const refresh = new Promise<ReturnType<typeof studyWithVisibility>>((resolve) => {
            replyToRefresh = resolve;
        });
        const api = {
            get: vi
                .fn(async () => studyWithVisibility("private"))
                .mockResolvedValueOnce(studyWithVisibility("private"))
                .mockReturnValueOnce(refresh),
            setVisibility: vi.fn(async () => ({ ok: true as const, status: 204, data: null })),
        };
        render(
            <StudyShareDialog
                studyId={studyId}
                api={api}
                unavailableReason={null}
                onClose={() => {}}
            />,
        );
        const privateButton = await screen.findByRole("button", { name: "非公開", pressed: true });
        fireEvent.focus(window);
        expect(api.get).toHaveBeenCalledTimes(2);
        fireEvent.click(privateButton);
        expect(api.setVisibility).toHaveBeenCalledWith(studyId, { visibility: "private" });
        await screen.findByText("公開設定を保存しました。");

        await act(async () => replyToRefresh(studyWithVisibility("unlisted")));
        expect(screen.getByRole("button", { name: "非公開", pressed: true })).toBeTruthy();
        expect(screen.queryByRole("textbox", { name: "共有リンク" })).toBeNull();
    });

    it("PUT の応答が失われたらサーバーに適用された公開設定を表示する", async () => {
        let serverVisibility: StudyVisibility = "private";
        const api = {
            get: vi.fn(async () => studyWithVisibility(serverVisibility)),
            setVisibility: vi.fn(
                async (_id: string, { visibility }: { visibility: StudyVisibility }) => {
                    serverVisibility = visibility;
                    return networkFailure;
                },
            ),
        };
        render(
            <StudyShareDialog
                studyId={studyId}
                api={api}
                unavailableReason={null}
                onClose={() => {}}
            />,
        );

        fireEvent.click(
            await screen.findByRole("button", { name: "リンクを知っている人が閲覧可" }),
        );
        fireEvent.focus(window);
        await screen.findByRole("textbox", { name: "共有リンク" });
        expect(screen.getByRole("status").textContent).toBe("公開設定を保存しました。");
        expect(screen.queryByRole("alert")).toBeNull();
        expect(api.get).toHaveBeenCalledTimes(2);
        expect(
            screen.getByRole("button", {
                name: "リンクを知っている人が閲覧可",
                pressed: true,
            }),
        ).toBeTruthy();
    });

    it.each([
        [403, "公開設定を変更する権限がありません。", "公開設定を変更する権限がありません。"],
        [500, undefined, "公開設定を保存できませんでした。"],
    ])(
        "PUT が status %i で拒否され、GET が元の設定を返したら保存エラーを出す",
        async (status, message, expected) => {
            const api = {
                get: vi.fn(async () => studyWithVisibility("private")),
                setVisibility: vi.fn(async () => ({
                    ok: false as const,
                    status,
                    error: { message },
                })),
            };
            render(
                <StudyShareDialog
                    studyId={studyId}
                    api={api}
                    unavailableReason={null}
                    onClose={() => {}}
                />,
            );

            fireEvent.click(
                await screen.findByRole("button", { name: "リンクを知っている人が閲覧可" }),
            );
            expect((await screen.findByRole("alert")).textContent).toBe(expected);
            expect(screen.getByRole("button", { name: "非公開", pressed: true })).toBeTruthy();
            expect(screen.queryByRole("textbox", { name: "共有リンク" })).toBeNull();
            expect(screen.queryByText("公開設定を保存しました。")).toBeNull();
            expect(api.get).toHaveBeenCalledTimes(2);
        },
    );

    it("PUT 後の GET が通信に失敗したら公開設定を隠し、再読み込みできる", async () => {
        const api = {
            get: vi
                .fn(
                    async (): Promise<
                        ReturnType<typeof studyWithVisibility> | typeof networkFailure
                    > => studyWithVisibility("unlisted"),
                )
                .mockResolvedValueOnce(studyWithVisibility("private"))
                .mockResolvedValueOnce(networkFailure),
            setVisibility: vi.fn(async () => networkFailure),
        };
        render(
            <StudyShareDialog
                studyId={studyId}
                api={api}
                unavailableReason={null}
                onClose={() => {}}
            />,
        );

        fireEvent.click(
            await screen.findByRole("button", { name: "リンクを知っている人が閲覧可" }),
        );
        const retry = await screen.findByRole("button", { name: "もう一度読み込む" });
        expect(screen.getByRole("alert").textContent).toBe("公開設定を読み込めませんでした。");
        expect(screen.queryByRole("button", { name: "非公開" })).toBeNull();
        fireEvent.click(retry);
        await screen.findByRole("textbox", { name: "共有リンク" });
        expect(api.get).toHaveBeenCalledTimes(3);
        expect(screen.queryByText("公開設定を保存しました。")).toBeNull();
    });

    it.each([
        { status: 404, retry: false, message: "クラウドに保存すると共有できます。" },
        { status: 410, retry: false, message: "このノートはクラウドから削除されています。" },
        { status: 404, retry: true, message: "クラウドに保存すると共有できます。" },
        { status: 410, retry: true, message: "このノートはクラウドから削除されています。" },
    ])(
        "PUT 後にサーバーに無い（$status、再読み込み $retry）なら共有できない理由を出す",
        async ({ status, retry, message }) => {
            const get = vi
                .fn<StudyApiClient["get"]>()
                .mockResolvedValue({ ok: false, status, error: {} })
                .mockResolvedValueOnce(studyWithVisibility("private"));
            if (retry) get.mockResolvedValueOnce(networkFailure);
            const api = { get, setVisibility: vi.fn(async () => networkFailure) };
            render(
                <StudyShareDialog
                    studyId={studyId}
                    api={api}
                    unavailableReason={null}
                    onClose={() => {}}
                />,
            );

            fireEvent.click(
                await screen.findByRole("button", { name: "リンクを知っている人が閲覧可" }),
            );
            if (retry) {
                fireEvent.click(await screen.findByRole("button", { name: "もう一度読み込む" }));
            }
            await screen.findByText(message);
            expect(screen.queryByRole("button", { name: "もう一度読み込む" })).toBeNull();
            expect(screen.queryByRole("button", { name: "非公開" })).toBeNull();
            expect(screen.queryByRole("alert")).toBeNull();
            expect(api.get).toHaveBeenCalledTimes(retry ? 3 : 2);
        },
    );

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
