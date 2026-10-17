import type { GameRecordDetail } from "@shogi/api-contract";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useLoaderData = vi.fn();
const exportGameRecordKif = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    getRouteApi: () => ({ useLoaderData }),
    Link: ({ children }: { children: ReactNode }) => <a href="/public/games/example">{children}</a>,
}));
vi.mock("@shogi/ui/components/online-game-state", () => ({ exportGameRecordKif }));
vi.mock("../../lib/studyEntry", () => ({
    canOpenGameRecordAsStudy: () => false,
    openStudyFromGameRecord: vi.fn(),
}));
vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("../../components/OpenStudyButton", () => ({ OpenStudyButton: () => null }));
vi.mock("../../components/PageContainer", () => ({
    PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../../components/Section", () => ({
    Section: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

const { default: GameDetailPage } = await import("./GameDetailPage");

const HANDICAP_SFEN = "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";

function game(overrides: Partial<GameRecordDetail> = {}): GameRecordDetail {
    return {
        id: "game-1",
        roomId: "room-1",
        publicId: null,
        source: "online_room",
        visibility: "private",
        status: "finished",
        result: { winner: "w", reason: "resign" },
        finishedAt: null,
        createdAt: "2026-07-21T00:00:00.000Z",
        participants: [
            { seat: "w", userId: null, displayNameSnapshot: "上手" },
            { seat: "b", userId: null, displayNameSnapshot: "下手" },
        ],
        initialSfen: HANDICAP_SFEN,
        metadata: null,
        moves: ["3c3d", "7g7f"],
        kifuText: "# KIF形式\n1 3c3d\n2 7g7f",
        startedAt: null,
        ...overrides,
    };
}

const kifText = () => screen.getByText(/KIF/, { selector: "pre" }).textContent;

describe("GameDetailPage の KIF テキスト", () => {
    beforeEach(() => {
        useLoaderData.mockReset();
        exportGameRecordKif.mockReset();
    });

    it("対局ルームの棋譜は開始局面と指し手から作った KIF を出す", async () => {
        exportGameRecordKif.mockResolvedValue("#KIF version=2.0\n手合割：角落ち");
        useLoaderData.mockReturnValue(game());

        render(<GameDetailPage />);

        await waitFor(() => expect(kifText()).toContain("手合割：角落ち"));
        expect(exportGameRecordKif).toHaveBeenCalledWith(
            { initialSfen: HANDICAP_SFEN, moves: ["3c3d", "7g7f"] },
            { b: "下手", w: "上手" },
        );
    });

    it("KIF を作れなければ保存された kifuText を出す", async () => {
        exportGameRecordKif.mockResolvedValue(null);
        useLoaderData.mockReturnValue(game());

        render(<GameDetailPage />);

        await waitFor(() => expect(exportGameRecordKif).toHaveBeenCalled());
        expect(kifText()).toBe(game().kifuText);
    });

    it("対局ルーム以外の棋譜は保存された kifuText をそのまま出す", () => {
        const imported = game({ source: "import", kifuText: "#KIF version=2.0\n手合割：平手" });
        useLoaderData.mockReturnValue(imported);

        render(<GameDetailPage />);

        expect(kifText()).toBe(imported.kifuText);
        expect(exportGameRecordKif).not.toHaveBeenCalled();
    });
});
