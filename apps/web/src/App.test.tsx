import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePlayHandoff } from "./lib/playHandoff";

interface CapturedShogiMatchProps {
    initialReview?: { sfen: string; moves: string[] };
    reviewMode?: boolean;
    viewerMode?: boolean;
    onPlayPhaseChange?: (phase: string) => void;
}

const capturedProps: CapturedShogiMatchProps[] = [];
let shouldBlock: (() => Promise<boolean>) | undefined;

vi.mock("@shogi/ui", () => ({
    ShogiMatch: (props: CapturedShogiMatchProps) => {
        capturedProps.push(props);
        return <div data-testid="shogi-match" />;
    },
    EngineControlPanel: () => null,
    useDevMode: () => false,
}));
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
    useBlocker: (opts: { shouldBlockFn: () => Promise<boolean> }) => {
        shouldBlock = opts.shouldBlockFn;
    },
    Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("./components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("./components/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("./hooks/useAccountNnue", () => ({
    useAccountNnue: () => undefined,
}));
vi.mock("./platform/wasm-engine-client", () => ({
    createWebWasmEngineClient: () => ({}),
    getWebWasmMaxThreads: () => 8,
}));

const { default: App } = await import("./App");
const { AppDialogHost } = await import("./components/AppDialogs");

const KEY = "ramu_review_kifu";
const MIDGAME_SFEN = "ln1gk1snl/1r4g2/p1ppppspp/6p2/1p5P1/2P6/PPSPPPP1P/2G4R1/LN2KGSNL w Bb 1";

describe("/play (App): 引き継がれた局面", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        capturedProps.length = 0;
    });
    afterEach(cleanup);

    it("引き継がれた局面があれば、その開始局面と手順を読み込んで開く", async () => {
        savePlayHandoff({ sfen: "startpos", moves: ["7g7f", "3c3d"] });

        render(<App />);
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview).toEqual({
            sfen: "startpos",
            moves: ["7g7f", "3c3d"],
        });
    });

    it("通常の対局画面として開く（見るだけの画面にも、設定を隠す検討画面にもしない）", async () => {
        savePlayHandoff({ sfen: "startpos", moves: ["7g7f"] });

        render(<App />);
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.viewerMode).toBeUndefined();
        expect(capturedProps.at(-1)?.reviewMode).toBeUndefined();
    });

    it("平手以外・後手番開始の局面も、SFEN のまま読み込む", async () => {
        savePlayHandoff({ sfen: MIDGAME_SFEN, moves: ["B*5e"] });

        render(<App />);
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview).toEqual({
            sfen: MIDGAME_SFEN,
            moves: ["B*5e"],
        });
    });

    it("読み込んだら消す（/play を開き直したときに前の局面を出さない）", async () => {
        savePlayHandoff({ sfen: "startpos", moves: ["7g7f"] });

        const first = render(<App />);
        await screen.findByTestId("shogi-match");
        expect(window.sessionStorage.getItem(KEY)).toBeNull();
        first.unmount();
        capturedProps.length = 0;

        render(<App />);
        await screen.findByTestId("shogi-match");
        expect(capturedProps.at(-1)?.initialReview).toBeUndefined();
    });

    it("StrictMode の二重実行でも、引き継がれた局面を取りこぼさない", async () => {
        savePlayHandoff({ sfen: "startpos", moves: ["7g7f"] });

        render(
            <StrictMode>
                <App />
            </StrictMode>,
        );
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview).toEqual({ sfen: "startpos", moves: ["7g7f"] });
    });

    it("引き継がれた局面が無ければ、何も読み込まずに開く", async () => {
        render(<App />);
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview).toBeUndefined();
    });
});

describe("/play (App): 対局中にページを離れるときの確認", () => {
    afterEach(cleanup);

    const startMatch = async () => {
        const view = render(<App />);
        render(<AppDialogHost />);
        await screen.findByTestId("shogi-match");
        act(() => capturedProps.at(-1)?.onPlayPhaseChange?.("playing"));
        return view;
    };

    it("確認中にもう一度離れようとしても、確認は 1 つだけ出して同じ答えを返す", async () => {
        await startMatch();
        let first: Promise<boolean> = Promise.resolve(false);
        let second: Promise<boolean> = Promise.resolve(false);
        await act(async () => {
            first = shouldBlock?.() ?? first;
            second = shouldBlock?.() ?? second;
        });
        expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
        act(() => screen.getByRole("button", { name: "対局に戻る" }).click());
        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
        expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("ページを離れたら、答えを待っている確認を閉じ、古い移動は止める", async () => {
        const view = await startMatch();
        let pending: Promise<boolean> = Promise.resolve(false);
        await act(async () => {
            pending = shouldBlock?.() ?? pending;
        });
        expect(screen.getByRole("alertdialog")).toBeTruthy();
        act(() => view.unmount());
        await expect(pending).resolves.toBe(true);
        expect(screen.queryByRole("alertdialog")).toBeNull();
    });
});
