import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let loaded = false;
let compact = false;
vi.mock("@shogi/ui", () => ({
    RshogiCsaViewer: ({
        renderGameAction,
    }: {
        renderGameAction: (game: unknown, options: { compact: boolean }) => ReactNode;
    }) =>
        loaded
            ? renderGameAction(
                  { meta: { senteName: "先手太郎", goteName: "後手花子" } },
                  { compact },
              )
            : null,
}));
vi.mock("@tanstack/react-router", () => ({
    getRouteApi: () => ({ useParams: () => ({ gameId: "game-1" }) }),
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("../../components/NavDrawer", () => ({ NavDrawer: () => null }));
vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/OpenStudyButton", () => ({ OpenStudyButton: () => null }));
vi.mock("../../hooks/usePlayFromPosition", () => ({ usePlayFromPosition: () => vi.fn() }));
vi.mock("../../lib/studyEntry", () => ({ openStudyFromRshogiGame: vi.fn() }));
vi.mock("../../platform/wasm-engine-client", () => ({ createWebWasmEngineClient: vi.fn() }));

const { default: RshogiViewerPage } = await import("./RshogiViewerPage");

afterEach(() => {
    cleanup();
    loaded = false;
    compact = false;
    document.title = "ラム将棋";
});

describe("棋譜の title", () => {
    it.each([false, true])(
        "棋譜の読み込み後に対局者名を表示し、離れると戻す (compact=%s)",
        async (isCompact) => {
            compact = isCompact;
            document.title = "ラム将棋";
            const view = render(<RshogiViewerPage />);
            expect(document.title).toBe("棋譜 | ラム将棋");
            loaded = true;
            view.rerender(<RshogiViewerPage />);
            await waitFor(() => expect(document.title).toBe("先手太郎 対 後手花子 | ラム将棋"));
            view.unmount();
            expect(document.title).toBe("ラム将棋");
        },
    );
});
