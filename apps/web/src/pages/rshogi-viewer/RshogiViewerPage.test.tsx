import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let gameId = "game-1";
let onGameLoaded: ((game: { meta: { senteName: string; goteName: string } }) => void) | undefined;
vi.mock("@shogi/ui", () => ({
    RshogiCsaViewer: (props: { onGameLoaded: typeof onGameLoaded }) => {
        onGameLoaded = props.onGameLoaded;
        return null;
    },
}));
vi.mock("@tanstack/react-router", () => ({
    getRouteApi: () => ({ useParams: () => ({ gameId }) }),
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
    gameId = "game-1";
    onGameLoaded = undefined;
    document.title = "ラム将棋";
});

describe("棋譜の title", () => {
    it("読み込み前、読み込み後、別の棋譜への移動で表示を切り替える", () => {
        document.title = "ラム将棋";
        const view = render(<RshogiViewerPage />);
        expect(document.title).toBe("棋譜 | ラム将棋");
        act(() => onGameLoaded?.({ meta: { senteName: "先手太郎", goteName: "後手花子" } }));
        expect(document.title).toBe("先手太郎 対 後手花子 | ラム将棋");
        expect(screen.getByText("先手太郎 対 後手花子")).toBeTruthy();
        gameId = "game-2";
        view.rerender(<RshogiViewerPage />);
        expect(document.title).toBe("棋譜 | ラム将棋");
        act(() => onGameLoaded?.({ meta: { senteName: "次の先手", goteName: "次の後手" } }));
        expect(document.title).toBe("次の先手 対 次の後手 | ラム将棋");
        view.unmount();
        expect(document.title).toBe("ラム将棋");
    });
});
